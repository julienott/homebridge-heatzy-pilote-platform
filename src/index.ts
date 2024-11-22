import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HeatzyPlatform } from './platform';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HeatzyPlatform as any);
  // The 'as any' cast is used here because the PlatformPluginConstructor type
  // doesn't fully support extended config types. This is a common pattern in
  // Homebridge plugins when using custom config interfaces.
};