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
                   .on('set', (value, callback) => this.setDeviceState(!!value, callback))
                   .on('get', (callback) => {
                     this.getDeviceState()
                       .then(isOn => callback(null, isOn))
                       .catch(error => {
                         this.platform.log.error('Error getting device state:', error);
                         callback(error); // Pass the error to the callback
                       });
                   });
    this.updateDeviceState();
  }

  async updateDeviceState() {
    try {
      const isOn = await this.getDeviceState();
      this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isOn);
    } catch (error) {
      this.platform.log.error('Error updating device state:', error);
    }
    setTimeout(() => this.updateDeviceState(), 60000); // 60 seconds
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
          const isOn = currentMode === this.mode;

          return isOn;
      } else {
          throw new Error('Non-200 response or invalid data format');
      }
  } catch (error) {
      this.platform.log.error('Failed to get device state:', error);
      throw error;
  }
}


}
