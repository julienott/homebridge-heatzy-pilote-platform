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

  // Public getter for mode
  getMode() {
    return this.mode;
  }


  private async fetchInitialState() {
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
        const isOn = currentMode === this.mode;
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isOn);

        // Update the cache with the real-time state
        this.platform.updateDeviceState(this.device.did, currentMode, true);

        if (isOn) {
          this.platform.log.info(`Initialized '${this.accessory.displayName}' with state: \u001b[32mOn\u001b[0m`);
        } else {
          this.platform.log.debug(`Initialized '${this.accessory.displayName}' with state: \u001b[31mOff\u001b[0m`);
        }
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      if (error instanceof Error) {
        this.platform.log.error(`Failed to fetch initial state for '${this.accessory.displayName}': ${error.message}`);
      } else {
        this.platform.log.error(`Unknown error fetching initial state for '${this.accessory.displayName}':`, error);
      }
    }
  }


  async setOnCharacteristicHandler(value: CharacteristicValue, callback: Function) {
    // Update HomeKit state immediately for user feedback
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, value as boolean);

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
        // Update the cache immediately after the API call is successful
        this.platform.setDeviceStateCache(this.device.did, this.mode);
        this.platform.notifyModeChange(this.device.did, this.mode);
      } else {
        // If turning off, update the cache to reflect the 'stop' state
        this.platform.setDeviceStateCache(this.device.did, 'stop');
      }

      // Log the successful state change
      this.platform.log.info(`Changed '${this.accessory.displayName}' to: ${value ? 'On' : 'Off'}`);
      callback(null); // No error
    } catch (error) {
      if (error instanceof Error) {
        this.platform.log.error('Failed to set device state:', error.message);
      } else {
        this.platform.log.error('Unknown error setting device state:', error);
      }
      // Revert HomeKit state in case of error
      this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, !value as boolean);
      callback(error); // Pass error to callback
    }
  }

  async getOnCharacteristicHandler(callback: Function) {
    this.platform.log.debug(`HomeKit is requesting the current state of '${this.accessory.displayName}'`);

    try {
      // Re-authenticate if needed
      if (this.platform.needsAuthentication()) {
        await this.platform.authenticate();
      }

      const currentState = this.platform.getDeviceState(this.device.did);
      const isOn = currentState === this.mode;

      // Log state determination
      if (isOn) {
        this.platform.log.debug(`Current state of '${this.accessory.displayName}' determined as On`);
      } else {
        this.platform.log.debug(`Current state of '${this.accessory.displayName}' determined as Off`);
      }

      // Call the callback once with the state
      callback(null, isOn);
    } catch (error) {
      this.platform.log.error(`Error determining state of '${this.accessory.displayName}':`, error);

      // Call the callback once with an error
      callback(error);
    }
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

        // Update the cache with the API response
        this.platform.setDeviceStateCache(this.device.did, currentMode);

        this.platform.log.debug(`Successfully received state for '${this.accessory.displayName}': ${currentMode}`);
        return currentMode === this.mode;
      } else {
        throw new Error('Non-200 response or invalid data format');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.platform.log.error(`Axios error getting device state for '${this.accessory.displayName}': ${error.message}`);
        if (error.response) {
          this.platform.log.debug(`Response data: ${JSON.stringify(error.response.data)}`);
        }
      } else if (error instanceof Error) {
        this.platform.log.error(`General error getting device state for '${this.accessory.displayName}': ${error.message}`);
      } else {
        this.platform.log.error(`Unknown error getting device state for '${this.accessory.displayName}':`, error);
      }
      return false;
    }
  }

  startPolling() {
    const basePollingInterval = 60000; // Base poll interval of 60 seconds
    const randomInterval = () => Math.floor(Math.random() * 10000) + 5000; // Random additional interval between 5 to 10 seconds

    const poll = async () => {
      try {
        // Add re-authentication logic if needed
        if (this.platform.needsAuthentication()) {
          await this.platform.authenticate();
        }

        const isOn = await this.getDeviceState();
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isOn);
      } catch (error) {
        if (error instanceof Error) {
          this.platform.log.error(`Error during polling for '${this.accessory.displayName}': ${error.message}`);
        } else {
          this.platform.log.error(`Unknown error during polling for '${this.accessory.displayName}':`, error);
        }
      }

      // Schedule the next poll with a random additional interval
      setTimeout(poll, basePollingInterval + randomInterval());
    };

    poll(); // Initial poll
  }
}