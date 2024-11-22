import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HeatzyPlatform } from './platform';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  // Platform registration should include the plugin name for better logging and debugging
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HeatzyPlatform);
};