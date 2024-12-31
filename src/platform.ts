import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  Service,
  Characteristic,
} from 'homebridge';
import { HeatzyAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { HeatzyApiClient } from './HeatzyApiClient.js';
import { RateLimiter } from './RateLimiter.js';
import { 
  HeatzyPlatformConfig, 
  HeatzyDevice, 
  DeviceState,
  HeatzyMode 
} from './types.js';

export class HeatzyPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly deviceStateCache: Map<string, DeviceState> = new Map();
  private readonly accessoryInstances: Map<string, HeatzyAccessory> = new Map();
  private readonly apiClient!: HeatzyApiClient;
  private readonly rateLimiter!: RateLimiter;

  constructor(
    public readonly log: Logger,
    public readonly config: HeatzyPlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    if (!this.validateConfig()) {
      return;
    }

    this.apiClient = new HeatzyApiClient(
      this.log,
      this.config.username!,
      this.config.password!
    );

    // Initialize rate limiter with 1 second interval
    this.rateLimiter = new RateLimiter(1000);

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.initializePlatform().catch(error => {
        this.log.error('Failed to initialize platform:', error);
      });
    });
  }

  private validateConfig(): boolean {
    if (!this.config.username || !this.config.password) {
      this.log.error('Missing required config: username and/or password');
      return false;
    }

    if (!Array.isArray(this.config.modes)) {
      this.log.warn('No modes specified in config, using default modes');
      this.config.modes = [HeatzyMode.CONFORT, HeatzyMode.ECO];
    }

    return true;
  }

  private async initializePlatform(): Promise<void> {
    try {
      await this.apiClient.authenticate();
      await this.discoverDevices();
    } catch (error) {
      this.log.error('Platform initialization failed:', error);
      throw error;
    }
  }

  private async discoverDevices(): Promise<void> {
    try {
      const response = await this.rateLimiter.schedule(() => 
        this.apiClient.getDevices()
      );

      const devices = response.devices;
      const selectedModes = this.config.modes || [];

      this.handleDeviceUpdates(devices, selectedModes);
      
      const deviceNames = devices.map(device => device.dev_alias || 'Unnamed Device').join(', ');
      this.log.info(`Fetched devices: ${devices.length} [${deviceNames}]`);
    } catch (error) {
      this.log.error('Error discovering devices:', error);
      throw error;
    }
  }

  private handleDeviceUpdates(devices: HeatzyDevice[], selectedModes: string[]): void {
    // Handle removed devices
    this.removeUnusedAccessories(devices, selectedModes);

    // Add or update devices
    devices.forEach(device => {
      selectedModes.forEach(mode => {
        this.addAccessory(device, mode);
      });
    });
  }

  private removeUnusedAccessories(devices: HeatzyDevice[], selectedModes: string[]): void {
    const existingAccessories = [...this.accessories];
    existingAccessories.forEach(accessory => {
      const isDeviceFetched = devices.some(device => accessory.context.device.did === device.did);
      const isModeSelected = selectedModes.includes(accessory.context.mode);

      if (!isDeviceFetched || !isModeSelected) {
        const accessoryInstance = this.accessoryInstances.get(accessory.UUID);
        if (accessoryInstance) {
          accessoryInstance.destroy(); // Clean up any timers
          this.accessoryInstances.delete(accessory.UUID);
        }

        const index = this.accessories.indexOf(accessory);
        if (index > -1) {
          this.accessories.splice(index, 1);
        }

        this.log.info('Removing unused accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    });
  }

  addAccessory(device: HeatzyDevice, mode: string): void {
    const uniqueId = `${device.did} ${mode}`;
    const uuid = this.api.hap.uuid.generate(uniqueId);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.updateExistingAccessory(existingAccessory, device, mode);
    } else {
      this.createNewAccessory(device, mode, uuid);
    }
  }

  private updateExistingAccessory(accessory: PlatformAccessory, device: HeatzyDevice, mode: string): void {
    this.log.debug('Restoring existing accessory from cache:', accessory.displayName);
    accessory.context.device = device;
    accessory.context.mode = mode;
    const accessoryInstance = new HeatzyAccessory(this, accessory, device, mode);
    this.accessoryInstances.set(accessory.UUID, accessoryInstance);
  }

  private createNewAccessory(device: HeatzyDevice, mode: string, uuid: string): void {
    const displayName = `${device.dev_alias} ${mode}`;
    this.log.info('Adding new accessory:', displayName);

    const accessory = new this.api.platformAccessory(displayName, uuid);
    accessory.context.device = device;
    accessory.context.mode = mode;
    const accessoryInstance = new HeatzyAccessory(this, accessory, device, mode);
    this.accessoryInstances.set(accessory.UUID, accessoryInstance);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.push(accessory);
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Configuring accessory:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async getDeviceState(deviceId: string): Promise<string> {
    const cachedState = this.deviceStateCache.get(deviceId);
    if (cachedState && cachedState.timestamp > Date.now() - 60000) {
      this.log.debug(`Using cached state for device '${deviceId}': ${cachedState.state}`);
      return cachedState.state;
    }

    try {
      const state = await this.rateLimiter.schedule(() => 
        this.apiClient.getDeviceState(deviceId)
      );
      const currentState = state.mode;
      this.setDeviceStateCache(deviceId, currentState);
      return currentState;
    } catch (error) {
      this.log.error(`Failed to get device state for ${deviceId}:`, error);
      return cachedState?.state || 'Unknown';
    }
  }

  async setDeviceMode(deviceId: string, mode: number): Promise<void> {
    await this.rateLimiter.schedule(() => 
      this.apiClient.setDeviceMode(deviceId, mode)
    );
  }

  updateDeviceState(did: string, activeMode: string, forceUpdate = false): void {
    const cachedState = this.deviceStateCache.get(did);
    if (!cachedState || forceUpdate || cachedState.timestamp < Date.now() - 60000) {
      this.deviceStateCache.set(did, { state: activeMode, timestamp: Date.now() });
      this.updateAccessoryStates(did, activeMode);
    }
  }

  private updateAccessoryStates(did: string, activeMode: string): void {
    this.accessories.forEach(accessory => {
      if (accessory.context.device.did === did) {
        const accessoryInstance = this.accessoryInstances.get(accessory.UUID);
        accessoryInstance?.updateState(activeMode);
      }
    });
  }

  notifyModeChange(did: string, activeMode: string): void {
    this.setDeviceStateCache(did, activeMode);
    this.updateOtherModesState(did, activeMode);
  }

  private updateOtherModesState(did: string, activeMode: string): void {
    this.accessories.forEach(accessory => {
      if (accessory.context.device.did === did) {
        const accessoryInstance = this.accessoryInstances.get(accessory.UUID);
        if (accessoryInstance && accessoryInstance.getMode() !== activeMode) {
          accessoryInstance.updateState('off');
        }
      }
    });
  }

  setDeviceStateCache(did: string, newState: string): void {
    this.deviceStateCache.set(did, { state: newState, timestamp: Date.now() });
  }

  getApiClient(): HeatzyApiClient {
    return this.apiClient;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }
}