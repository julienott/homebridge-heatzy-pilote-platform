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
  private mode: string;

  constructor(
    private readonly platform: Heatzy,
    private readonly accessory: PlatformAccessory,
    private readonly device: any,
    mode: string,
  ) {
    this.mode = mode;
    this.platform.log.info('Initializing accessory:', accessory.displayName);

    this.service = this.accessory.getService(this.platform.api.hap.Service.Switch) ||
                   this.accessory.addService(this.platform.api.hap.Service.Switch, accessory.displayName);

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .on('set', (value, callback) => this.setOnCharacteristicHandler(value, callback))
      .on('get', callback => this.getOnCharacteristicHandler(callback));

    this.fetchInitialState();
    this.startPolling();
  }

  private async fetchInitialState() {
    try {
      const isOn = await this.getDeviceState();

      // Update the cache with the fetched state
      this.platform.updateDeviceState(this.device.did, isOn ? this.mode : 'Off');

      this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isOn);
      this.platform.log.info(`Initialized '${this.accessory.displayName}' with state: ${isOn ? 'On' : 'Off'}`);
    } catch (error) {
      this.platform.log.error(`Failed to fetch initial state for '${this.accessory.displayName}':`, error);
    }
  }

  async setOnCharacteristicHandler(value: CharacteristicValue, callback: Function) {
    if (this.platform.needsAuthentication()) {
      await this.platform.authenticate();
    }

    const modeToSet = value ? this.modeMapping[this.mode] : this.off_mode;
    const url = `https://euapi.gizwits.com/app/control/${this.device.did}`;
    const payload = { attrs: { mode: modeToSet } };

    try {
      await axios.post(url, payload, {
        headers: {
          'X-Gizwits-Application-Id': 'c70a66ff039d41b4a220e198b0fcc8b3',
          'X-Gizwits-User-token': this.platform.getToken(),
        },
      });

      if (value) {
        this.platform.updateDeviceState(this.device.did, this.mode);
      }

      this.platform.log.info(`Device state for '${this.accessory.displayName}' set to: ${value ? 'On' : 'Off'}`);
      callback(null); // No error
    } catch (error) {
      this.platform.log.error('Failed to set device state:', error);
      callback(error); // Pass error to callback
    }
  }

  async getOnCharacteristicHandler(callback: Function) {
    this.platform.log.info(`HomeKit is requesting the current state of '${this.accessory.displayName}'`);

    if (this.platform.needsAuthentication()) {
      await this.platform.authenticate();
    }

    const currentState = this.platform.getDeviceState(this.device.did);
    const isOn = currentState === this.mode;

    this.platform.log.info(`Current state of '${this.accessory.displayName}' determined as: ${isOn ? 'On' : 'Off'}`);
    callback(null, isOn);
  }

  updateState(activeMode: string) {
    const isOn = activeMode === this.mode;
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isOn);
  }


  async getDeviceState(): Promise<boolean> {
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

      if (response.status === 200 && response.data && response.data.attr) {
        const apiMode = response.data.attr.mode;
        const currentMode = this.reverseModeMapping[apiMode] || 'Unknown';
        return currentMode === this.mode;
      } else {
        throw new Error('Non-200 response or invalid data format');
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        // Log only the status code for normal operation
        this.platform.log.error(`Error getting device state for '${this.accessory.displayName}', Status Code: ${error.response.status}`);
        // More verbose log for debugging
        this.platform.log.debug('Error details:', error);
      } else if (error instanceof Error) {
        // General error logging for non-Axios errors
        this.platform.log.error(`Error getting device state for '${this.accessory.displayName}':`, error.message);
      } else {
        // Fallback for when error is not an Error instance
        this.platform.log.error(`Error getting device state for '${this.accessory.displayName}', but the error type is unknown.`);
      }
      return false;
    }
  }

  startPolling() {
    const basePollingInterval = 60000; // Base poll interval of 60 seconds
    const randomInterval = () => Math.floor(Math.random() * 10000) + 5000; // Random additional interval between 5 to 10 seconds

    const poll = async () => {
      const isOn = await this.getDeviceState();
      this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isOn);

      // Schedule the next poll with a random additional interval
      setTimeout(poll, basePollingInterval + randomInterval());
    };

    poll(); // Initial poll
  }
}