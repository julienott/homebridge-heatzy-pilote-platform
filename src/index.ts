import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { HeatzyPlatform } from './platform.js';
import { HeatzyPlatformConfig } from './types.js';

export default (api: API) => {
  api.registerPlatform<HeatzyPlatformConfig>(PLUGIN_NAME, PLATFORM_NAME, HeatzyPlatform);
};