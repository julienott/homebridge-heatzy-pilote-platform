import axios from 'axios';
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { HeatzyAccessory } from './platformAccessory';

export class Heatzy implements DynamicPlatformPlugin {
  private readonly accessories: PlatformAccessory[] = [];
  private readonly deviceStateCache: Record<string, { state: string; timestamp: number }> = {};
  private readonly accessoryInstances: Map<string, HeatzyAccessory> = new Map();
  private token: string | null = null;
  private tokenExpireAt: number | null = null;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info('Heatzy Plugin Finished Launching');
    this.api.on('didFinishLaunching', () => this.authenticate());
  }

  async authenticate() {
    try {
      const response = await axios.post('https://euapi.gizwits.com/app/login', {
        username: this.config.username,
        password: this.config.password,
        lang: 'en',
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Gizwits-Application-Id': 'c70a66ff039d41b4a220e198b0fcc8b3',
        },
      });

      this.token = response.data.token;
      this.tokenExpireAt = new Date().getTime() - 10000; // forcing the token refresh
      this.fetchDevices();
    } catch (error) {
      this.log.error('Error authenticating:', (error as Error).message);
    }
  }

  async fetchDevices() {
    if (this.needsAuthentication()) {
      await this.authenticate();
    }
    if (!this.token) {
      this.log.error('Token not available, unable to fetch devices');
      return;
    }

    try {
      const response = await axios.get('https://euapi.gizwits.com/app/bindings?limit=20&skip=0', {
        headers: {
          'Accept': 'application/json',
          'X-Gizwits-User-token': this.token,
          'X-Gizwits-Application-Id': 'c70a66ff039d41b4a220e198b0fcc8b3',
        },
      });

      const devices = response.data.devices;
      const selectedModes = this.config.modes || [];

      // Additional code to list device names
      const deviceNames = devices.map(device => device.dev_alias || 'Unnamed Device').join(', ');

      this.accessories.forEach(accessory => {
        const isDeviceFetched = devices.some(device => accessory.context.device.did === device.did);
        const isModeSelected = selectedModes.includes(accessory.context.mode);

        if (!isDeviceFetched || !isModeSelected) {
          this.log.info('Removing unused accessory:', accessory.displayName);
          this.api.unregisterPlatformAccessories('homebridge-heatzy-pilote-platform', 'Heatzy', [accessory]);
        }
      });

      devices.forEach(device => {
        selectedModes.forEach(mode => {
          this.addAccessory(device, mode);
        });
      });

      this.log.info(`Fetched devices: ${devices.length} [${deviceNames}]`);
    } catch (error) {
      this.log.error('Error fetching devices:', (error as Error).message);
    }
  }


  addAccessory(device: any, mode: string) {
    const uniqueId = device.did + ' ' + mode;
    const uuid = this.api.hap.uuid.generate(uniqueId);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.debug('Restoring existing accessory from cache:', existingAccessory.displayName);
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
      this.api.registerPlatformAccessories('homebridge-heatzy-pilote-platform', 'Heatzy', [accessory]);
      this.accessories.push(accessory);
    }
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Configuring accessory:', accessory.displayName);
    this.accessories.push(accessory);
  }

  updateDeviceState(did: string, activeMode: string, forceUpdate = false) {
    const cachedState = this.deviceStateCache[did];
    if (!cachedState || forceUpdate || cachedState.timestamp < Date.now() - 60000) { // 60 seconds threshold
      this.deviceStateCache[did] = { state: activeMode, timestamp: Date.now() };
      this.accessories.forEach(accessory => {
        if (accessory.context.device.did === did) {
          const accessoryInstance = this.accessoryInstances.get(accessory.UUID);
          accessoryInstance?.updateState(activeMode);
        }
      });
    }
  }

  notifyModeChange(did: string, activeMode: string) {
    this.deviceStateCache[did] = { state: activeMode, timestamp: Date.now() };

    // Loop through all accessories and update their state
    this.accessories.forEach(accessory => {
      if (accessory.context.device.did === did) {
        const accessoryInstance = this.accessoryInstances.get(accessory.UUID);
        if (accessoryInstance && accessoryInstance.getMode() !== activeMode) {
          accessoryInstance.updateState('off'); // Set other modes to off
        }
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

  getToken(): string | null {
    return this.token;
  }

  needsAuthentication(): boolean {
    // Check if token is either not set or expired
    return !this.token || !this.tokenExpireAt || this.tokenExpireAt < Date.now();
  }
}
