import { PlatformConfig } from 'homebridge';

export interface HeatzyPlatformConfig extends PlatformConfig {
  username?: string;
  password?: string;
  modes?: string[];
}

export interface HeatzyDevice {
  did: string;
  dev_alias: string;
  product_name?: string;
  mac?: string;
  is_online?: boolean;
}

export interface DeviceState {
  state: string;
  timestamp: number;
}

export enum HeatzyMode {
  CONFORT = 'Confort',
  ECO = 'Eco',
  ECO_PLUS = 'Eco Plus',
  SLEEP = 'Sleep',
  ANTIFREEZE = 'Antifreeze',
  OFF = 'Off'
}

export const ModeMappings = {
  [HeatzyMode.CONFORT]: 0,
  [HeatzyMode.ECO]: 4,
  [HeatzyMode.ECO_PLUS]: 5,
  [HeatzyMode.SLEEP]: 1,
  [HeatzyMode.ANTIFREEZE]: 2,
  [HeatzyMode.OFF]: 3,
} as const;

export const ApiModeMappings = {
  'cft': HeatzyMode.CONFORT,
  'eco': HeatzyMode.SLEEP,
  'fro': HeatzyMode.ANTIFREEZE,
  'stop': HeatzyMode.OFF,
  'cft1': HeatzyMode.ECO,
  'cft2': HeatzyMode.ECO_PLUS,
} as const;