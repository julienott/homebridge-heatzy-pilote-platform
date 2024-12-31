type BinaryState = 0 | 1;

enum HeatzyMode {
  Comfort = 0,
  Sleep = 1,
  Antifreeze = 2,
  Off = 3,
  Eco = 4,
  EcoPlus = 5,
}

interface HeatzyDeviceResponse {
  did: string;
  created_at: number;
  updated_at: number;
  attr: {
    mode: HeatzyMode;
    derog_mode?: BinaryState;
    derog_time?: number;
    lock_switch?: BinaryState;
    timer_switch?: BinaryState;
    pX_dataY?: number;
    [key: string]: number | undefined;
  };
}

interface HeatzyDeviceData {
  did: string;
  mac: string;
  product_key: string;
  dev_alias: string;
  is_online: boolean;
  wifi_soft_version?: string;
  mcu_soft_version?: string;
  product_name?: string;
  [key: string]: string | boolean | undefined;
}

export {
  BinaryState,
  HeatzyMode,
  HeatzyDeviceResponse,
  HeatzyDeviceData,
};