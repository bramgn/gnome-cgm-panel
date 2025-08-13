// cgmGraph.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gdk from 'gi://Gdk';

// Default colors, to be overridden by config
const DEFAULT_COLORS = {
    low: 'rgb(255, 70, 70)',      // Red
    high: 'rgb(255, 170, 0)',     // Orange
    normal: 'rgb(255, 255, 255)', // White
};

export class CGMGraph {
    constructor(width = 300, height = 150, thresholds = null, graphHours = 6, colors = {}, debugLog = () => {}) {
        this.width = width;
        this.height = height;
        this.padding = { top: 20, right: 20, bottom: 30, left: 40 };
        this.data = [];
        this.thresholds = thresholds || { low: 4.0, high: 10.0 };
        this.graphHours = graphHours;
        this.cgmInterval = 1;
        this.log = debugLog;

        this.drawingArea = new St.DrawingArea({
            width: this.width,
            height: this.height,
            style_class: 'cgm-graph'
        });
        
        this.drawingArea.connect('repaint', (area) => {
            this._draw(area);
        });

        this.setColors(colors);
    }

    setColors(colors) {
        this.colors = { ...DEFAULT_COLORS, ...colors };
        // Pre-parse colors for performance
        this.parsedColors = {};
        for (const key in this.colors) {
            const rgba = new Gdk.RGBA();
            if (rgba.parse(this.colors[key])) {
                this.parsedColors[key] = [rgba.red, rgba.green, rgba.blue];
            } else {
                this.log(`Invalid color string for ${key}: ${this.colors[key]}`);
                // Fallback to default if parsing fails
                const defaultRgba = new Gdk.RGBA();
                defaultRgba.parse(DEFAULT_COLORS[key]);
                this.parsedColors[key] = [defaultRgba.red, defaultRgba.green, defaultRgba.blue];
            }
        }
        this.drawingArea.queue_repaint();
    }
    
    setThresholds(thresholds) {
        this.thresholds = thresholds;
        this.drawingArea.queue_repaint();
    }

    setGraphHours(graphHours) {
        this.graphHours = graphHours;
        this.drawingArea.queue_repaint();
    }
    
    setData(dataPoints) {
        // dataPoints should be array of {time: Date, value: number}
        // Validate and sort data
        this.data = dataPoints
            .filter(point => point && point.time && typeof point.value === 'number' && !isNaN(point.value))
            .sort((a, b) => a.time - b.time);
            
        this.log(`Graph received ${this.data.length} valid data points`);
        if (this.data.length > 0) {
            this.log(`First point: ${this.data[0].value} at ${this.data[0].time}`);
            this.log(`Last point: ${this.data[this.data.length-1].value} at ${this.data[this.data.length-1].time}`);
        }
        this.drawingArea.queue_repaint();
    }
    
    getWidget() {
        return this.drawingArea;
    }
    
    _draw(area) {
        let cr = area.get_context();
        let [width, height] = area.get_surface_size();
        
        // Clear background
        cr.setSourceRGB(0.1, 0.1, 0.1);
        cr.rectangle(0, 0, width, height);
        cr.fill();
        
        if (this.data.length === 0) {
            this._drawNoData(cr, width, height);
            return;
        }
        
        // Calculate chart area
        let chartWidth = width - this.padding.left - this.padding.right;
        let chartHeight = height - this.padding.top - this.padding.bottom;
        
        // Calculate Y-axis scale: always start at 0, go up to a nice round number
        let values = this.data.map(d => d.value);
        let maxDataValue = Math.max(...values);
        let minValue = 0; // Always start at 0
        
        // Determine a preliminary max value, at least 15
        let preliminaryMaxValue = Math.max(15, maxDataValue + 1);
        
        // Round up to the next nice number for the grid (a multiple of 6, since we have 6 grid lines)
        let maxValue = Math.ceil(preliminaryMaxValue / 6) * 6;
        let valueRange = maxValue - minValue;
        
        // Time range - calculate the full time window we want to show
        let now = new Date();
        let startTime = new Date(now.getTime() - (this.graphHours * 60 * 60 * 1000));
        let timeRange = now - startTime;
        
        // Draw grid lines first
        this._drawGrid(cr, chartWidth, chartHeight, minValue, maxValue, startTime, now);
        
        // Draw the line with colors
        this._drawColoredLine(cr, chartWidth, chartHeight, minValue, valueRange, startTime, timeRange);
        
        // Draw axes labels
        this._drawLabels(cr, width, height, minValue, maxValue, startTime, now);
    }
    
    _getColorForValue(value) {
        if (value < this.thresholds.low) {
            return this.parsedColors.low;
        } else if (value > this.thresholds.high) {
            return this.parsedColors.high;
        } else {
            return this.parsedColors.normal;
        }
    }
    
    _drawColoredLine(cr, chartWidth, chartHeight, minValue, valueRange, startTime, timeRange) {
        if (this.data.length < 2) {
            // If we only have one point, draw it as a dot
            if (this.data.length === 1) {
                this._drawSinglePoint(cr, chartWidth, chartHeight, minValue, valueRange, startTime, timeRange);
            }
            return;
        }
        
        cr.setLineWidth(2);
        
        // Draw line segments with appropriate colors
        for (let i = 0; i < this.data.length - 1; i++) {
            let currentPoint = this.data[i];
            let nextPoint = this.data[i + 1];
            
            // Calculate time differences from start time
            let currentTimeDiff = currentPoint.time - startTime;
            let nextTimeDiff = nextPoint.time - startTime;

            let timeBetweenPoints = nextPoint.time - currentPoint.time;
            let maxGapMinutes = 5;
            if (timeBetweenPoints > maxGapMinutes * 60 * 1000) {
                continue; // Skip drawing this segment
            }

            // Skip this segment if either point is outside the visible time window
            if (currentTimeDiff < 0 || nextTimeDiff < 0 ||
                currentTimeDiff > timeRange || nextTimeDiff > timeRange) {
                continue;
            }

            // Use the color of the current point for this segment
            let color = this._getColorForValue(currentPoint.value);
            cr.setSourceRGB(color[0], color[1], color[2]);
            
            // Calculate positions relative to the full time window
            let x1 = this.padding.left + (currentTimeDiff / timeRange * chartWidth);
            let y1 = this.padding.top + chartHeight - 
                    ((currentPoint.value - minValue) / valueRange * chartHeight);

            let x2 = this.padding.left + (nextTimeDiff / timeRange * chartWidth);
            let y2 = this.padding.top + chartHeight - 
                    ((nextPoint.value - minValue) / valueRange * chartHeight);

            // Validate coordinates
            if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
                this.log(`Invalid coordinates: (${x1}, ${y1}) to (${x2}, ${y2})`);
                continue;
            }

            cr.moveTo(x1, y1);
            cr.lineTo(x2, y2);
            cr.stroke();
        }
    }

    _drawSinglePoint(cr, chartWidth, chartHeight, minValue, valueRange, startTime, timeRange) {
        let point = this.data[0];
        let timeDiff = point.time - startTime;
        
        if (timeDiff < 0 || timeDiff > timeRange) {
            return; // Point is outside visible range
        }
        
        let color = this._getColorForValue(point.value);
        cr.setSourceRGB(color[0], color[1], color[2]);
        
        let x = this.padding.left + (timeDiff / timeRange * chartWidth);
        let y = this.padding.top + chartHeight - 
                ((point.value - minValue) / valueRange * chartHeight);
        
        if (!isNaN(x) && !isNaN(y)) {
            cr.arc(x, y, 3, 0, 2 * Math.PI);
            cr.fill();
        }
    }

    _drawNoData(cr, width, height) {
        cr.setSourceRGB(0.7, 0.7, 0.7);
        cr.selectFontFace('Sans', 0, 0);
        cr.setFontSize(14);
        
        let text = 'No data available';
        let textExtents = cr.textExtents(text);
        cr.moveTo(
            (width - textExtents.width) / 2,
            height / 2
        );
        cr.showText(text);
    }

    _drawGrid(cr, chartWidth, chartHeight, minValue, maxValue, startTime, endTime) {
        cr.setSourceRGB(0.3, 0.3, 0.3);
        cr.setLineWidth(0.5);
        
        // Horizontal grid lines (for glucose values)
        let numHorizontalLines = 6;
        for (let i = 0; i <= numHorizontalLines; i++) {
            let y = this.padding.top + (chartHeight * i / numHorizontalLines);
            cr.moveTo(this.padding.left, y);
            cr.lineTo(this.padding.left + chartWidth, y);
            cr.stroke();
        }
        
        // Vertical grid lines (for time)
        let numVerticalLines = 6;
        for (let i = 0; i <= numVerticalLines; i++) {
            let x = this.padding.left + (chartWidth * i / numVerticalLines);
            cr.moveTo(x, this.padding.top);
            cr.lineTo(x, this.padding.top + chartHeight);
            cr.stroke();
        }
        
        // Draw threshold lines
        this._drawThresholdLines(cr, chartWidth, chartHeight, minValue, maxValue - minValue);
    }
    
    _drawThresholdLines(cr, chartWidth, chartHeight, minValue, valueRange) {
        cr.setLineWidth(0.8);

        const drawLine = (value, color) => {
            if (value >= minValue && value <= minValue + valueRange) {
                const y = this.padding.top + chartHeight - ((value - minValue) / valueRange * chartHeight);
                if (!isNaN(y)) {
                    cr.setSourceRGB(color[0], color[1], color[2]);
                    // Draw dashed line
                    for (let x = this.padding.left; x < this.padding.left + chartWidth; x += 6) {
                        cr.rectangle(x, y, 2, 1);
                        cr.fill();
                    }
                }
            }
        };

        drawLine(this.thresholds.low, this.parsedColors.low);
        drawLine(this.thresholds.high, this.parsedColors.high);
    }
    
    _drawLabels(cr, width, height, minValue, maxValue, startTime, endTime) {
        cr.setSourceRGB(0.8, 0.8, 0.8);
        cr.selectFontFace('Sans', 0, 0);
        cr.setFontSize(10);
        
        // Y-axis labels (glucose values) - now always starts at 0
        let valueStep = (maxValue - minValue) / 6;
        for (let i = 0; i <= 6; i++) {
            let value = minValue + (valueStep * (6 - i));

            // Don't draw the label for 0.0 to make the graph look friendlier
            if (value < 0.1) {
                continue;
            }

            let text = value.toFixed(1);
            let y = this.padding.top + (height - this.padding.top - this.padding.bottom) * i / 6;
            
            let textExtents = cr.textExtents(text);
            if (!isNaN(textExtents.width)) {
                cr.moveTo(this.padding.left - textExtents.width - 5, y + 3);
                cr.showText(text);
            }
        }
        
        // X-axis labels - show time marks
        this._drawTimeLabels(cr, width, height, startTime, endTime);
    }

    _drawTimeLabels(cr, width, height, startTime, endTime) {
        let chartWidth = width - this.padding.left - this.padding.right;
        let now = new Date();
        
        // Calculate appropriate time step based on graph hours
        let timeStep;
        
        if (this.graphHours <= 6) {
            timeStep = 1 * 60 * 60 * 1000; // 1 hour
        } else if (this.graphHours <= 12) {
            timeStep = 2 * 60 * 60 * 1000; // 2 hours
        } else if (this.graphHours <= 24) {
            timeStep = 4 * 60 * 60 * 1000; // 4 hours
        } else { // for 48h
            timeStep = 8 * 60 * 60 * 1000; // 8 hours
        }
        
        // Find time marks to display
        let timeMarks = [];
        let currentTime = new Date(Math.ceil(startTime.getTime() / timeStep) * timeStep);
        
        while (currentTime <= endTime) {
            if (currentTime >= startTime) {
                timeMarks.push(currentTime);
            }
            currentTime = new Date(currentTime.getTime() + timeStep);
        }
        
        // Draw the time marks
        timeMarks.forEach(mark => {
            let timeDiff = mark - startTime;
            let timeRange = endTime - startTime;
            let x = this.padding.left + (timeDiff / timeRange * chartWidth);
            
            let text = `${mark.getHours()}:00`;
            
            let textExtents = cr.textExtents(text);
            if (!isNaN(textExtents.width) && !isNaN(x)) {
                cr.moveTo(x - textExtents.width / 2, height - 5);
                cr.showText(text);
            }
        });
    }
}
