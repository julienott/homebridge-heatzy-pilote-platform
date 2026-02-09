import axios, { AxiosError } from 'axios';
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { HeatzyAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

interface HeatzyConfig extends PlatformConfig {
  username?: string;
  password?: string;
  modes?: string[];
}

interface HeatzyDevice {
  did: string;
  dev_alias: string;
  product_name?: string;
  mac?: string;
  is_online?: boolean;
}

interface DeviceState {
  state: string;
  timestamp: number;
}

export class HeatzyPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly deviceStateCache: Record<string, DeviceState> = {};
  private readonly accessoryInstances: Map<string, HeatzyAccessory> = new Map();
  private readonly lastUserActionPerDevice: Record<string, number> = {};
  private token: string | null = null;
  private tokenExpireAt: number | null = null;
  private authPromise: Promise<void> | null = null;

  // API constants
  private static readonly API_BASE_URL = 'https://euapi.gizwits.com';
  private static readonly APPLICATION_ID = 'c70a66ff039d41b4a220e198b0fcc8b3';
  private static readonly TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes

  constructor(
    public readonly log: Logger,
    public readonly config: HeatzyConfig,
    public readonly api: API,
  ) {
    // Save references to service and characteristic for use in accessories
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    // Validate configuration
    if (!this.validateConfig()) {
      return;
    }

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired, homebridge restored all cached accessories from disk
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.authenticate().catch(error => {
        this.log.error('Failed to authenticate during initialization:', error);
      });
    });
  }

  private validateConfig(): boolean {
    if (!this.config.username || !this.config.password) {
      this.log.error('Missing required config: username and/or password. Visit the plugin configuration.');
      return false;
    }

    if (!Array.isArray(this.config.modes)) {
      this.log.warn('No modes specified in config, using default modes');
      this.config.modes = ['Confort', 'Eco'];
    }

    if (typeof this.config.lockThermostats !== 'boolean') {
      this.log.warn('lockThermostats not specified in config, defaulting to false');
      this.config.lockThermostats = false;
    }

    return true;
  }

  async authenticate(): Promise<void> {
    if (this.authPromise) {
      return this.authPromise;
    }

    this.authPromise = this._authenticate();
    try {
      await this.authPromise;
    } finally {
      this.authPromise = null;
    }
  }

  private async _authenticate(): Promise<void> {
    try {
      const response = await axios.post(`${HeatzyPlatform.API_BASE_URL}/app/login`, {
        username: this.config.username,
        password: this.config.password,
        lang: 'en',
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Gizwits-Application-Id': HeatzyPlatform.APPLICATION_ID,
        },
      });

      this.token = response.data.token;
      this.tokenExpireAt = response.data.expire_at * 1000;

      const expirationDate = this.tokenExpireAt ? new Date(this.tokenExpireAt).toLocaleString() : 'Unknown';
      this.log.debug(`Authenticated successfully. Token expires at: ${expirationDate}`);
      await this.fetchDevices();
    } catch (error) {
      if (error instanceof AxiosError) {
        this.log.error('Authentication failed:', error.message);
        this.log.debug('Error details:', error.response?.data);
      } else {
        this.log.error('Unexpected error during authentication:', error);
      }
      throw error;
    }
  }

  async fetchDevices(): Promise<void> {
    if (this.needsAuthentication()) {
      await this.authenticate();
    }

    if (!this.token) {
      this.log.error('Token not available, unable to fetch devices');
      return;
    }

    try {
      const response = await axios.get(`${HeatzyPlatform.API_BASE_URL}/app/bindings`, {
        headers: {
          'Accept': 'application/json',
          'X-Gizwits-User-token': this.token,
          'X-Gizwits-Application-Id': HeatzyPlatform.APPLICATION_ID,
        },
      });

      const devices = response.data.devices as HeatzyDevice[];
      const selectedModes = this.config.modes || [];

      // Additional code to list device names
      const deviceNames = devices.map(device => device.dev_alias || 'Unnamed Device').join(', ');

      // Handle removed devices
      const existingAccessories = [...this.accessories];
      existingAccessories.forEach(accessory => {
        const isDeviceFetched = devices.some(device => accessory.context.device.did === device.did);
        const isModeSelected = selectedModes.includes(accessory.context.mode);

        if (!isDeviceFetched || !isModeSelected) {
          const removedAccessoryIndex = this.accessories.indexOf(accessory);
          if (removedAccessoryIndex !== -1) {
            this.accessories.splice(removedAccessoryIndex, 1);
          }
          this.log.info('Removing unused accessory:', accessory.displayName);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      });

      // Add or update devices
      devices.forEach(device => {
        selectedModes.forEach(mode => {
          this.addAccessory(device, mode);
        });
      });

      this.log.info(`Fetched devices: ${devices.length} [${deviceNames}]`);
    } catch (error) {
      if (error instanceof AxiosError) {
        this.log.error('Error fetching devices:', error.message);
        this.log.debug('Error details:', error.response?.data);
      } else {
        this.log.error('Unexpected error fetching devices:', error);
      }
    }
  }

  addAccessory(device: HeatzyDevice, mode: string): void {
    const uniqueId = device.did + ' ' + mode;
    const uuid = this.api.hap.uuid.generate(uniqueId);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);
      const existingInstance = this.accessoryInstances.get(existingAccessory.UUID);
      existingInstance?.stopPolling();
      existingAccessory.context.device = device;
      existingAccessory.context.mode = mode;
      const accessoryInstance = new HeatzyAccessory(this, existingAccessory, device, mode);
      this.accessoryInstances.set(existingAccessory.UUID, accessoryInstance);
    } else {
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
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Configuring accessory:', accessory.displayName);
    this.accessories.push(accessory);
  }

  updateDeviceState(did: string, activeMode: string, forceUpdate = false): void {
    const cachedState = this.deviceStateCache[did];
    if (!forceUpdate && cachedState?.state === activeMode) {
      return;
    }
    this.deviceStateCache[did] = { state: activeMode, timestamp: Date.now() };
    this.accessories.forEach(accessory => {
      if (accessory.context.device.did === did) {
        const accessoryInstance = this.accessoryInstances.get(accessory.UUID);
        accessoryInstance?.updateState(activeMode);
      }
    });
  }

  notifyModeChange(did: string, activeMode: string): void {
    this.setDeviceStateCache(did, activeMode);

    this.accessories.forEach(accessory => {
      if (accessory.context.device.did === did) {
        const accessoryInstance = this.accessoryInstances.get(accessory.UUID);
        accessoryInstance?.updateState(activeMode);
      }
    });
  }

  getDeviceState(did: string): string | null {
    const cachedState = this.deviceStateCache[did];
    if (cachedState) {
      this.log.debug(`Retrieving cached state for device '${did}': ${cachedState.state}`);
      return cachedState.state;
    }
    return null;
  }

  setDeviceStateCache(did: string, newState: string): void {
    this.deviceStateCache[did] = { state: newState, timestamp: Date.now() };
  }

  setLastUserAction(did: string): void {
    this.lastUserActionPerDevice[did] = Date.now();
  }

  shouldSkipPolling(did: string): boolean {
    const lastAction = this.lastUserActionPerDevice[did] || 0;
    return Date.now() - lastAction < 10000;
  }

  getToken(): string | null {
    return this.token;
  }

  needsAuthentication(): boolean {
    return !this.token || !this.tokenExpireAt || this.tokenExpireAt - HeatzyPlatform.TOKEN_REFRESH_BUFFER < Date.now();
  }
}