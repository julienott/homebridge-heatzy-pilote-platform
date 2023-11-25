![Heatzy Logo](https://raw.githubusercontent.com/julienott/homebridge-heatzy-pilote-platform/latest/heatzy.png)

# Homebridge Platform Plugin for Heatzy Pilote devices

Homebridge plugin for Heatzy Pilote devices, considered as switches, for any mode.

This plugin automatically imports your Heatzy devices with your credentials. 

Heatzy uses the 'fil pilote' protocol to control an electric heater, with 6 states.

Possible values for `mode` in the configuration file are:
* `Confort`  turns on heating to the temperature set physically on your radiator.
* `Eco` is Confort minus 1 degree
* `Eco Plus` is Confort minus 2 degrees
* `Sleep` is Confort minus 4 degrees
* `Antifreeze` is set to 7 degrees to prevent freezing


## Installation & Configuration

Install or update this plugin using `npm i -g homebridge-heatzy-pilote-platform`.

Visit the plugin configuration once installed to enter your Heatzy credentials.

Select at least one mode to import your accessories.


## Notes

* When you toggle a switch on or off for a particular mode, it's possible that other modes may still appear active. This is because the plugin updates the information only once every 60 seconds.



## Credits and inspiration
https://github.com/Fourni-j/homebridge-heatzy-pilote-eco

https://github.com/AlainKaim/homebridge-heatzy-as-switch