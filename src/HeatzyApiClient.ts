import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from 'homebridge';

interface AuthResponse {
  token: string;
  expire_at: number;
}

interface DeviceResponse {
  devices: Array<{
    did: string;
    dev_alias: string;
    product_name?: string;
    mac?: string;
    is_online?: boolean;
  }>;
}

export class HeatzyApiClient {
  private static readonly API_BASE_URL = 'https://euapi.gizwits.com';
  private static readonly APPLICATION_ID = 'c70a66ff039d41b4a220e198b0fcc8b3';
  private axiosInstance: AxiosInstance;
  private token: string | null = null;
  private tokenExpireAt: number | null = null;

  constructor(
    private readonly log: Logger,
    private readonly username: string,
    private readonly password: string
  ) {
    this.axiosInstance = axios.create({
      baseURL: HeatzyApiClient.API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Gizwits-Application-Id': HeatzyApiClient.APPLICATION_ID,
      },
    });

    // Add response interceptor for automatic token refresh
    this.axiosInstance.interceptors.response.use(
      response => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401 && error.config) {
          await this.authenticate();
          error.config.headers['X-Gizwits-User-token'] = this.token;
          return this.axiosInstance(error.config);
        }
        return Promise.reject(error);
      }
    );
  }

  public async authenticate(): Promise<void> {
    try {
      const response = await this.axiosInstance.post<AuthResponse>('/app/login', {
        username: this.username,
        password: this.password,
        lang: 'en',
      });

      this.token = response.data.token;
      this.tokenExpireAt = response.data.expire_at * 1000;
      this.axiosInstance.defaults.headers['X-Gizwits-User-token'] = this.token;

      this.log.debug(`Authentication successful. Token expires at: ${new Date(this.tokenExpireAt).toLocaleString()}`);
    } catch (error) {
      this.log.error('Authentication failed:', this.formatError(error));
      throw error;
    }
  }

  public async getDevices(): Promise<DeviceResponse> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axiosInstance.get<DeviceResponse>('/app/bindings');
      return response.data;
    } catch (error) {
      this.log.error('Failed to fetch devices:', this.formatError(error));
      throw error;
    }
  }

  public async setDeviceMode(deviceId: string, mode: number): Promise<void> {
    await this.ensureAuthenticated();
    try {
      await this.axiosInstance.post(`/app/control/${deviceId}`, {
        attrs: { mode }
      });
    } catch (error) {
      this.log.error(`Failed to set mode for device ${deviceId}:`, this.formatError(error));
      throw error;
    }
  }

  public async getDeviceState(deviceId: string): Promise<{ mode: string }> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axiosInstance.get(`/app/devdata/${deviceId}/latest`);
      return response.data.attr;
    } catch (error) {
      this.log.error(`Failed to get state for device ${deviceId}:`, this.formatError(error));
      throw error;
    }
  }

  public isTokenExpired(): boolean {
    return !this.token || !this.tokenExpireAt || this.tokenExpireAt < Date.now();
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.isTokenExpired()) {
      await this.authenticate();
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof AxiosError) {
      return `${error.message} (${error.response?.status}): ${JSON.stringify(error.response?.data)}`;
    }
    return String(error);
  }
}