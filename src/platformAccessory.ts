import axios, { AxiosError } from 'axios';
import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { HeatzyPlatform } from './platform.js';

interface HeatzyDeviceData {
  did: string;
  dev_alias: string;
  product_name?: string;
  mac?: string;
  is_online?: boolean;
}

interface HeatzyDeviceResponse {
  attr: {
    mode: string;
    [key: string]: string;
  };
}

export class HeatzyAccessory {
  private service: Service;
  private readonly modeMapping = {
    'Confort': 0,
    'Eco': 4,
    'Eco Plus': 5,
    'Sleep': 1,
    'Antifreeze': 2,
  } as const;

  private readonly reverseModeMapping = {
    'cft': 'Confort',
    'eco': 'Sleep',
    'fro': 'Antifreeze',
    'stop': 'Off',
    'cft1': 'Eco',
    'cft2': 'Eco Plus',
  } as const;

  private readonly off_mode = 3;
  private readonly mode: string;
  private static readonly API_BASE_URL = 'https://euapi.gizwits.com';
  private static readonly APPLICATION_ID = 'c70a66ff039d41b4a220e198b0fcc8b3';

  constructor(
    private readonly platform: HeatzyPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: HeatzyDeviceData,
    mode: string,
  ) {
    this.mode = mode;
    this.platform.log.info('Initializing accessory:', accessory.displayName);

    this.service = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(
        this.platform.Service.Switch,
        accessory.displayName
      );

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOnCharacteristicHandler.bind(this))
      .onGet(this.getOnCharacteristicHandler.bind(this));

    this.fetchInitialState();
    this.startPolling();
  }

  getMode(): string {
    return this.mode;
  }

  private async fetchInitialState(): Promise<void> {
    try {
      if (this.platform.needsAuthentication()) {
        await this.platform.authenticate();
      }

      const url = `${HeatzyAccessory.API_BASE_URL}/app/devdata/${this.device.did}/latest`;
      const response = await axios.get<HeatzyDeviceResponse>(url, {
        headers: {
          'Accept': 'application/json',
          'X-Gizwits-User-token': this.platform.getToken(),
          'X-Gizwits-Application-Id': HeatzyAccessory.APPLICATION_ID,
        },
      });

      if (response.data?.attr) {
        const apiMode = response.data.attr.mode;
        const currentMode = this.reverseModeMapping[apiMode as keyof typeof this.reverseModeMapping] || 'Unknown';
        const isOn = currentMode === this.mode;
        
        this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
        this.platform.updateDeviceState(this.device.did, currentMode, true);

        const stateText = isOn ? '\u001b[32mOn\u001b[0m' : '\u001b[31mOff\u001b[0m';
        const logMessage = `Initialized '${this.accessory.displayName}' with state: ${stateText}`;
        this.platform.log[isOn ? 'info' : 'debug'](logMessage);
      }
    } catch (error) {
      this.handleError('Failed to fetch initial state', error);
    }
  }

  private async setOnCharacteristicHandler(value: CharacteristicValue): Promise<void> {
    this.service.updateCharacteristic(this.platform.Characteristic.On, value as boolean);

    try {
      if (this.platform.needsAuthentication()) {
        await this.platform.authenticate();
      }

      const modeToSet = value ? this.modeMapping[this.mode as keyof typeof this.modeMapping] : this.off_mode;
      const url = `${HeatzyAccessory.API_BASE_URL}/app/control/${this.device.did}`;
      const payload = { 
        attrs: { 
            mode: modeToSet,
            lock_switch: 1
        }
      };

      await axios.post(url, payload, {
        headers: {
          'X-Gizwits-Application-Id': HeatzyAccessory.APPLICATION_ID,
          'X-Gizwits-User-token': this.platform.getToken(),
        },
      });

      if (value) {
        this.platform.setDeviceStateCache(this.device.did, this.mode);
        this.platform.notifyModeChange(this.device.did, this.mode);
      } else {
        this.platform.setDeviceStateCache(this.device.did, 'stop');
      }

      this.platform.log.info(`Changed '${this.accessory.displayName}' to: ${value ? 'On' : 'Off'}`);
    } catch (error) {
      this.handleError('Failed to set device state', error);
      this.service.updateCharacteristic(this.platform.Characteristic.On, !value as boolean);
      throw error;
    }
  }

  private async getOnCharacteristicHandler(): Promise<boolean> {
    this.platform.log.debug(
      `HomeKit is requesting the current state of '${this.accessory.displayName}'`
    );

    const currentState = this.platform.getDeviceState(this.device.did);
    const isOn = currentState === this.mode;

    const stateText = isOn ? '\u001b[32mOn\u001b[0m' : '\u001b[31mOff\u001b[0m';
    this.platform.log.debug(
      `Current state of '${this.accessory.displayName}' determined as ${stateText}`
    );
    
    return isOn;
  }

  updateState(activeMode: string): void {
    const isOn = activeMode === this.mode;
    this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
  }

  private async getDeviceState(): Promise<boolean> {
    try {
      if (this.platform.needsAuthentication()) {
        await this.platform.authenticate();
      }

      const url = `${HeatzyAccessory.API_BASE_URL}/app/devdata/${this.device.did}/latest`;
      const response = await axios.get<HeatzyDeviceResponse>(url, {
        headers: {
          'Accept': 'application/json',
          'X-Gizwits-User-token': this.platform.getToken(),
          'X-Gizwits-Application-Id': HeatzyAccessory.APPLICATION_ID,
        },
      });

      if (response.data?.attr) {
        const apiMode = response.data.attr.mode;
        const currentMode = this.reverseModeMapping[apiMode as keyof typeof this.reverseModeMapping] || 'Unknown';
        this.platform.setDeviceStateCache(this.device.did, currentMode);
        this.platform.log.debug(`Successfully received state for '${this.accessory.displayName}': ${currentMode}`);
        return currentMode === this.mode;
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      this.handleError('Error getting device state', error);
      return false;
    }
  }

  private handleError(context: string, error: unknown): void {
    if (error instanceof AxiosError && error.response) {
      this.platform.log.error(`${context} for '${this.accessory.displayName}', Status Code: ${error.response.status}`);
      this.platform.log.debug('Error details:', error.response.data);
    } else if (error instanceof Error) {
      this.platform.log.error(`${context} for '${this.accessory.displayName}':`, error.message);
    } else {
      this.platform.log.error(`${context} for '${this.accessory.displayName}' with unknown error type`);
    }
  }

  private startPolling(): void {
    const basePollingInterval = 60000;
    const randomInterval = () => Math.floor(Math.random() * 10000) + 5000;

    const poll = async () => {
      try {
        const isOn = await this.getDeviceState();
        this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
      } catch (error) {
        this.handleError('Error during polling', error);
      }

      setTimeout(poll, basePollingInterval + randomInterval());
    };

    poll();
  }
}