# CGM Panel

Monitor your blood glucose levels directly from the Gnome Shell panel with support for multiple CGM data sources.

## Features

- **Real-time glucose monitoring** displayed in the top panel
- **Interactive graphs** with customizable time windows (3h, 6h, 12h, 24h, 48h)
- **Multiple data sources** - Nightscout API and LibreLink
- **Smart alerts** for high/low glucose levels
- **Time in Range** statistics
- **Trend arrows** showing glucose direction
- **Flexible units** - switch between mg/dL and mmol/L
- **Customizable thresholds** and colors
- **Auto-refresh** with configurable intervals

## Screenshots

![Graph Popup](screenshots/popup.png)

## Installation

### From GNOME Extensions Website
*(Coming soon)*

### Manual Installation
1. Clone this repository:
   ```bash
   git clone https://github.com/bramgn/gnome-cgm-panel.git
   cd gnome-cgm-panel
   ```

2. Copy to your extensions directory:
   ```bash
   cp -r . ~/.local/share/gnome-shell/extensions/gnome-cgm-panel@bramgn/
   ```

3. Restart GNOME Shell:
   - Press `Alt+F2`, type `r`, press Enter (X11)
   - Or log out and back in (Wayland)

4. Enable the extension:
   ```bash
   gnome-extensions enable gnome-cgm-panel@bramgn
   ```

## Configuration

### Nightscout Setup
1. Open extension preferences
2. Select "Nightscout" as provider
3. Enter your Nightscout URL (e.g., `https://yoursite.herokuapp.com`)
4. Add your API token if required
5. Configure units, thresholds, and refresh intervals

### LibreLink Setup
1. Open extension preferences
2. Select "LibreLink" as provider
3. Enter your LibreLink credentials
4. Select your region (US/EU)
5. Configure display preferences

## Requirements

- GNOME Shell 47+
- For LibreLink: Valid LibreLink account
- For Nightscout: Accessible Nightscout instance

## Troubleshooting

### Extension not showing data
- Check your provider configuration in preferences
- Verify network connectivity
- Check logs: `journalctl -f -o cat /usr/bin/gnome-shell`

### LibreLink authentication issues
- Verify credentials are correct
- Check if your region setting matches your account
- Try restarting the extension

### Nightscout connection problems
- Ensure URL is correct and accessible
- Verify API token if your site requires authentication
- Check if your Nightscout instance is online

## Development

### Building from Source
```bash
git clone https://github.com/bramgn/gnome-cgm-panel.git
cd gnome-cgm-panel
# No build process required - it's pure JavaScript
```

### Testing
```bash
# Enable debug logging in preferences, then:
journalctl -f -o cat /usr/bin/gnome-shell | grep "CGM"
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This extension is not a medical device and should not be used as the sole basis for medical decisions. Always consult your healthcare provider and use approved medical devices for diabetes management.

## Support

- Report bugs: [GitHub Issues](https://github.com/bramgn/gnome-cgm-panel/issues)
- Feature requests: [GitHub Discussions](https://github.com/bramgn/gnome-cgm-panel/discussions)

## Acknowledgments

- Thanks to the Nightscout community for their open-source diabetes management platform
- Thanks to Timo Schlueter for his [LibreLinkUp](https://github.com/timoschlueter/nightscout-librelink-up) project, which helped me adding the LibreLink provider integration
- Inspired by various CGM monitoring tools and the need for desktop integration
