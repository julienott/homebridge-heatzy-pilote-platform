import { PlatformAccessory, Service, Characteristic, CharacteristicValue } from 'homebridge';
import axios from 'axios';
import { Heatzy } from './platform';

export class HeatzyAccessory {
  private service: Service;
  private modeMapping = {
    'Confort': 0,
    'Eco': 4,
    'Eco Plus': 5,
    'Sleep': 1,
    'Antifreeze': 2,
  };

  private reverseModeMapping = {
    'cft': 'Confort',
    'eco': 'Sleep',
    'fro': 'Antifreeze',
    'stop': 'Off',
    'cft1': 'Eco',
    'cft2': 'Eco Plus',
  };

  private off_mode = 3;
  private mode: string; // Add mode as a class property

  constructor(
    private readonly platform: Heatzy,
    private readonly accessory: PlatformAccessory,
    private readonly device: any,
    mode: string, // Constructor parameter
  ) {
    this.mode = mode; // Store mode
    this.platform.log.info('Initializing accessory:', accessory.displayName);

    this.service = this.accessory.getService(this.platform.api.hap.Service.Switch) ||
                   this.accessory.addService(this.platform.api.hap.Service.Switch, accessory.displayName);

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .on('set', (value, callback) => this.setDeviceState(!!value, callback))
      .on('get', callback => this.getDeviceState(callback));
    this.startPolling();
  }

  // Add a method to fetch device status periodically
  startPolling() {
    // Fetch the device status initially
    this.getDeviceState((error, isOn) => {
      if (!error) {
        // Schedule to fetch device status every 60 seconds (60,000 milliseconds)
        setInterval(() => {
          this.getDeviceState((error, isOn) => {
            if (error) {
              this.platform.log.error('Failed to fetch device state:', error);
            }
          });
        }, 60000); // 60 seconds
      } else {
        this.platform.log.error('Failed to fetch initial device state:', error);
      }
    });
  }

  async setDeviceState(value: boolean, callback: Function) {
    if (this.platform.needsAuthentication()) {
      await this.platform.authenticate();
    }

    const modeToSet = value ? this.modeMapping[this.mode] : this.off_mode;
    const url = `https://euapi.gizwits.com/app/control/${this.device.did}`;
    const payload = { attrs: { mode: modeToSet } };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'X-Gizwits-Application-Id': 'c70a66ff039d41b4a220e198b0fcc8b3',
          'X-Gizwits-User-token': this.platform.getToken(),
        },
      });

      if (response.status === 200) {
        // Log the success message with device name, mode, and state
        const stateStr = value ? 'On' : 'Off';
        this.platform.log.info(`Device state set successfully: ${this.accessory.displayName} - Mode: ${this.mode} - State: ${stateStr}`);
        callback(null); // No error
      } else {
        throw new Error(`Request failed with status code ${response.status}`);
      }
    } catch (error) {
      this.platform.log.error('Failed to set device state:', (error as Error).message);
      callback(error); // Error
    }
  }

  async getDeviceState(callback: Function) {
    if (this.platform.needsAuthentication()) {
      await this.platform.authenticate();
    }

    const url = `https://euapi.gizwits.com/app/devdata/${this.device.did}/latest`;

    try {
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'X-Gizwits-User-token': this.platform.getToken(),
          'X-Gizwits-Application-Id': 'c70a66ff039d41b4a220e198b0fcc8b3',
        },
      });

      // Log the status code and response data for debugging
      // this.platform.log.debug('Response status:', response.status);
      // this.platform.log.debug('Response data:', response.data);

      if (response.status === 200 && response.data && response.data.attr) {
        const apiMode = response.data.attr.mode;
        const currentMode = this.reverseModeMapping[apiMode] || 'Unknown'; // Default to 'Unknown' if not found
        const isOn = currentMode === this.mode; // Compare with human-readable mode

        if (currentMode === 'Unknown') {
          // Log the mode received from the API
          this.platform.log.warn(`Unknown mode received from API: ${apiMode}`);
        }
        this.platform.log.info(`Fetched device state: ${this.accessory.displayName} - Mode: ${currentMode} - State: ${isOn ? 'On' : 'Off'}`);
        callback(null, isOn);
      } else {
        throw new Error('Non-200 response or invalid data format');
      }
    } catch (error) {
      this.platform.log.error('Failed to get device state:', (error as Error).message);
      if (axios.isAxiosError(error) && error.response) {
        // Log the detailed response for more insight
        // this.platform.log.error('Error response:', error.response.data);
      }
      callback(error);
    }
  }

}
