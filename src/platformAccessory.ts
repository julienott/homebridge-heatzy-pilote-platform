import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { HeatzyPlatform } from './platform.js';
import { HeatzyDevice, HeatzyMode, ModeMappings } from './types.js';

export class HeatzyAccessory {
  private service!: Service;
  private readonly OFF_MODE = 3;
  private readonly mode: string;
  private pollingTimeout?: NodeJS.Timeout;
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_POLLING_INTERVAL = 10000; // 10 seconds
  private readonly RETRY_DELAY = 3000; // 3 seconds
  private readonly MAX_JITTER = 2000; // 2 seconds

  constructor(
    private readonly platform: HeatzyPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: HeatzyDevice,
    mode: string,
  ) {
    this.mode = mode;
    this.platform.log.info('Initializing accessory:', accessory.displayName);

    this.initializeService();
    this.fetchInitialState();
    this.startPolling();
  }

  private initializeService(): void {
    this.service = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(
        this.platform.Service.Switch,
        this.accessory.displayName
      );

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOnCharacteristicHandler.bind(this))
      .onGet(this.getOnCharacteristicHandler.bind(this));
  }

  getMode(): string {
    return this.mode;
  }

  private async fetchInitialState(): Promise<void> {
    try {
      const currentMode = await this.platform.getDeviceState(this.device.did);
      const isOn = currentMode === this.mode;
      
      this.updateServiceState(isOn);
      this.platform.updateDeviceState(this.device.did, currentMode, true);

      this.logStateChange('Initialized', isOn);
    } catch (error) {
      this.handleError('Failed to fetch initial state', error);
    }
  }

  private async setOnCharacteristicHandler(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean;
    this.updateServiceState(isOn);

    try {
      const modeToSet = isOn ? ModeMappings[this.mode as HeatzyMode] : this.OFF_MODE;
      await this.platform.setDeviceMode(this.device.did, modeToSet);

      if (isOn) {
        this.platform.setDeviceStateCache(this.device.did, this.mode);
        this.platform.notifyModeChange(this.device.did, this.mode);
      } else {
        this.platform.setDeviceStateCache(this.device.did, 'stop');
      }

      this.logStateChange('Changed', isOn);
    } catch (error) {
      this.handleError('Failed to set device state', error);
      this.updateServiceState(!isOn); // Revert UI state on error
      throw error;
    }
  }

  private async getOnCharacteristicHandler(): Promise<boolean> {
    this.platform.log.debug(
      `HomeKit is requesting the current state of '${this.accessory.displayName}'`
    );

    const currentState = await this.platform.getDeviceState(this.device.did);
    const isOn = currentState === this.mode;

    this.logStateChange('Current state', isOn);
    return isOn;
  }

  updateState(activeMode: string): void {
    const isOn = activeMode === this.mode;
    this.updateServiceState(isOn);
  }

  private updateServiceState(isOn: boolean): void {
    this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
  }

  private handleError(context: string, error: unknown): void {
    if (error instanceof Error) {
      this.platform.log.error(
        `${context} for '${this.accessory.displayName}':`,
        error.message
      );
    } else {
      this.platform.log.error(
        `${context} for '${this.accessory.displayName}' with unknown error type:`,
        error
      );
    }

    if (this.retryCount < this.MAX_RETRIES) {
      this.retryCount++;
      this.platform.log.debug(
        `Retrying operation (${this.retryCount}/${this.MAX_RETRIES}) in ${this.RETRY_DELAY}ms`
      );
      setTimeout(() => this.fetchInitialState(), this.RETRY_DELAY);
    } else {
      this.retryCount = 0;
      this.platform.log.error('Max retries reached, giving up');
    }
  }

  private startPolling(): void {
    const poll = async () => {
      try {
        const currentMode = await this.platform.getDeviceState(this.device.did);
        const isOn = currentMode === this.mode;
        this.updateServiceState(isOn);
        this.retryCount = 0; // Reset retry counter on successful poll
      } catch (error) {
        this.handleError('Error during polling', error);
      } finally {
        // Schedule next poll with jitter
        const jitter = Math.random() * this.MAX_JITTER;
        this.pollingTimeout = setTimeout(poll, this.BASE_POLLING_INTERVAL + jitter);
      }
    };

    poll();
  }

  private logStateChange(context: string, isOn: boolean): void {
    const stateText = isOn ? '\u001b[32mOn\u001b[0m' : '\u001b[31mOff\u001b[0m';
    const logMessage = `${context} '${this.accessory.displayName}' state: ${stateText}`;
    this.platform.log[isOn ? 'info' : 'debug'](logMessage);
  }

  public destroy(): void {
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
    }
  }
}