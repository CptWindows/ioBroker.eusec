import axios, { AxiosResponse, Method } from "axios";
import { ResultResponse, FullDeviceResponse, HubResponse, LoginResultResponse, TrustDevice } from "./models"
import { EventEmitter } from "events";
import { ApiInterface, FullDevices, Hubs, IParameter } from "./interfaces";
import { ResponseErrorCode, VerfyCodeTypes } from "./types";
import { Parameter } from "./parameter";
import { getTimezoneGMTString } from "./utils";

export class API extends EventEmitter implements ApiInterface {

    private api_base = "https://mysecurity.eufylife.com/api/v1";

    private username: string|null = null;
    private password: string|null = null;

    private token: string|null = null;
    private token_expiration: Date|null = null;
    private trusted_token_expiration = new Date(2100, 12, 31, 23, 59, 59, 0);

    private log: ioBroker.Logger;

    private devices: FullDevices = {};
    private hubs: Hubs = {};

    private headers = {
        app_version: "v2.3.0_792",
        os_type: "android",
        os_version: "29",
        phone_model: "ONEPLUS A3003",
        //phone_model: "ioBroker",
        country: "DE",
        language: "de",
        openudid: "5e4621b0152c0d00",
        uid: "",
        net_type: "wifi",
        mnc: "02",
        mcc: "262",
        sn: "75814221ee75",
        Model_type: "PHONE",
        timezone: "GMT+01:00"
    };

    constructor(username: string, password: string, log: ioBroker.Logger) {
        super();

        this.username = username;
        this.password = password;
        this.log = log;

        this.headers.timezone = getTimezoneGMTString();
    }

    private invalidateToken(): void {
        this.token = null;
        this.token_expiration = null;
        axios.defaults.headers.common["X-Auth-Token"] = null;
    }

    public async authenticate(): Promise<string> {
        //Authenticate and get an access token
        this.log.debug(`API.authenticate(): token: ${this.token} token_expiration: ${this.token_expiration}`);
        if (!this.token || this.token_expiration && (new Date()).getTime() >= this.token_expiration.getTime()) {
            try {
                const response = await this.request("post", "passport/login", {
                    email: this.username,
                    password: this.password
                }, this.headers).catch(error => {
                    this.log.error(`API.authenticate(): error: ${JSON.stringify(error)}`);
                    return error;
                });
                this.log.debug(`API.authenticate(): Response:  ${JSON.stringify(response.data)}`);

                if (response.status == 200) {
                    const result: ResultResponse = response.data;
                    if (result.code == ResponseErrorCode.CODE_WHATEVER_ERROR) {
                        const dataresult: LoginResultResponse = result.data;

                        this.token = dataresult.auth_token
                        this.token_expiration = new Date(dataresult.token_expires_at * 1000);
                        axios.defaults.headers.common["X-Auth-Token"] = this.token;

                        if (dataresult.domain) {
                            if ("https://" + dataresult.domain + "/v1" != this.api_base) {
                                this.api_base = "https://" + dataresult.domain + "/v1";
                                axios.defaults.baseURL = this.api_base;
                                this.log.info(`Switching to another API_BASE (${this.api_base}) and get new token.`);
                                this.token = null;
                                this.token_expiration = null;
                                axios.defaults.headers.common["X-Auth-Token"] = null;
                                return "renew";
                            }
                        }

                        this.log.debug(`API.authenticate(): token: ${this.token}`);
                        this.log.debug(`API.authenticate(): token_expiration: ${this.token_expiration}`);
                        return "ok";
                    } else if (result.code == ResponseErrorCode.CODE_NEED_VERIFY_CODE) {
                        this.log.debug(`API.authenticate(): Send verification code...`);
                        const dataresult: LoginResultResponse = result.data;

                        this.token = dataresult.auth_token
                        this.token_expiration = new Date(dataresult.token_expires_at * 1000);
                        axios.defaults.headers.common["X-Auth-Token"] = this.token;

                        this.log.debug(`API.authenticate(): token: ${this.token}`);
                        this.log.debug(`API.authenticate(): token_expiration: ${this.token_expiration}`);

                        await this.sendVerifyCode(VerfyCodeTypes.TYPE_EMAIL);

                        return "send_verify_code";
                    } else {
                        this.log.error(`API.authenticate(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
                    }
                } else {
                    this.log.error(`API.authenticate(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
                }
            } catch (error) {
                this.log.error(`API.authenticate(): error: ${error}`);
            }
            return "error";
        }
        return "ok";
    }

    public async sendVerifyCode(type?: VerfyCodeTypes): Promise<boolean> {
        try {
            if (!type)
                type = VerfyCodeTypes.TYPE_EMAIL;

            const response = await this.request("post", "sms/send/verify_code", {
                message_type: type
            }, this.headers).catch(error => {
                this.log.error(`API.sendVerifyCode(): error: ${JSON.stringify(error)}`);
                return error;
            });
            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == ResponseErrorCode.CODE_WHATEVER_ERROR) {
                    this.log.info(`Requested verification code for 2FA`);
                    return true;
                } else {
                    this.log.error(`API.sendVerifyCode(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
                }
            } else {
                this.log.error(`API.sendVerifyCode(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.sendVerifyCode(): error: ${error}`);
        }
        return false;
    }

    public async listTrustDevice(): Promise<Array<TrustDevice>> {
        try {
            const response = await this.request("get", "app/trust_device/list", undefined, this.headers).catch(error => {
                this.log.error(`API.listTrustDevice(): error: ${JSON.stringify(error)}`);
                return error;
            });
            this.log.debug(`API.listTrustDevice(): Response:  ${JSON.stringify(response.data)}`);

            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == ResponseErrorCode.CODE_WHATEVER_ERROR) {
                    if (result.data && result.data.list) {
                        return result.data.list;
                    }
                } else {
                    this.log.error(`API.listTrustDevice(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
                }
            } else {
                this.log.error(`API.listTrustDevice(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.listTrustDevice(): error: ${error}`);
        }
        return [];
    }

    public async addTrustDevice(verify_code: number): Promise<boolean> {
        try {
            const response = await this.request("post", "passport/login", {
                verify_code: `${verify_code}`,
                transaction: `${new Date().getTime()}`
            }, this.headers).catch(error => {
                this.log.error(`API.listTrustDevice(): error: ${JSON.stringify(error)}`);
                return error;
            });
            this.log.debug(`API.addTrustDevice(): Response:  ${JSON.stringify(response.data)}`);

            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == ResponseErrorCode.CODE_WHATEVER_ERROR) {
                    const response2 = await this.request("post", "app/trust_device/add", {
                        verify_code: `${verify_code}`,
                        transaction: `${new Date().getTime()}`
                    }, this.headers);
                    this.log.debug(`API.addTrustDevice(): Response2:  ${JSON.stringify(response.data)}`);

                    if (response2.status == 200) {
                        const result: ResultResponse = response2.data;
                        if (result.code == ResponseErrorCode.CODE_WHATEVER_ERROR) {
                            this.log.info(`2FA authentication successfully done. Device trusted.`);
                            const trusted_devices = await this.listTrustDevice();
                            trusted_devices.forEach((trusted_device: TrustDevice) => {
                                if (trusted_device.is_current_device === 1) {
                                    this.token_expiration = this.trusted_token_expiration;
                                    this.log.debug(`API.addTrustDevice(): This device is trusted. Token expiration extended to: ${this.token_expiration})`);
                                }
                            });
                            return true;
                        } else {
                            this.log.error(`API.addTrustDevice(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
                        }
                    } else if (response2.status == 401) {
                        this.invalidateToken();
                        this.log.error(`API.addTrustDevice(): Status return code 401, invalidate token (status: ${response.status} text: ${response.statusText}`);
                    } else {
                        this.log.error(`API.addTrustDevice(): Status return code not 200 (status: ${response2.status} text: ${response2.statusText}`);
                    }
                } else {
                    this.log.error(`API.addTrustDevice(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
                }
            } else {
                this.log.error(`API.addTrustDevice(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.addTrustDevice(): error: ${error}`);
        }
        return false;
    }

    public async updateDeviceInfo(): Promise<void> {
        //Get the latest device info

        //Get Stations
        try {
            const response = await this.request("post", "app/get_hub_list").catch(error => {
                this.log.error(`API.updateDeviceInfo(): stations - error: ${JSON.stringify(error)}`);
                return error;
            });
            this.log.debug(`API.updateDeviceInfo(): stations - Response: ${JSON.stringify(response.data)}`);

            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == 0) {
                    const dataresult: Array<HubResponse> = result.data;
                    if (dataresult) {
                        dataresult.forEach(element => {
                            this.log.debug(`API.updateDeviceInfo(): stations - element: ${JSON.stringify(element)}`);
                            this.log.debug(`API.updateDeviceInfo(): stations - device_type: ${element.device_type}`);
                            //if (element.device_type == 0) {
                            // Station
                            this.hubs[element.station_sn] = element;
                            //}
                        });
                    } else {
                        this.log.info("No stations found.");
                    }

                    if (Object.keys(this.hubs).length > 0)
                        this.emit("hubs", this.hubs);
                } else
                    this.log.error(`API.updateDeviceInfo(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
            } else {
                this.log.error(`API.updateDeviceInfo(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.updateDeviceInfo(): error: ${error}`);
        }

        //Get Devices
        try {
            const response = await this.request("post", "app/get_devs_list").catch(error => {
                this.log.error(`API.updateDeviceInfo(): devices - error: ${JSON.stringify(error)}`);
                return error;
            });
            this.log.debug(`API.updateDeviceInfo(): devices - Response: ${JSON.stringify(response.data)}`);

            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == 0) {
                    const dataresult: Array<FullDeviceResponse> = result.data;
                    if (dataresult) {
                        dataresult.forEach(element => {
                            this.devices[element.device_sn] = element;
                        });
                    } else {
                        this.log.info("No devices found.");
                    }

                    if (Object.keys(this.devices).length > 0)
                        this.emit("devices", this.devices);
                } else
                    this.log.error(`API.updateDeviceInfo(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
            } else {
                this.log.error(`API.updateDeviceInfo(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.updateDeviceInfo(): error: ${error}`);
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async request(method: Method, endpoint: string, data?: any, headers?: any): Promise<AxiosResponse<any>> {

        if (!this.token && endpoint != "passport/login") {
            //No token get one
            switch (await this.authenticate()) {
                case "renew":
                    this.log.debug(`API.request(): renew token - method: ${method} endpoint: ${endpoint}`);
                    await this.authenticate();
                    break;
                case "error":
                    this.log.debug(`API.request(): token error - method: ${method} endpoint: ${endpoint}`);
                    break;
                default: break;
            }
        }
        if (this.token_expiration && (new Date()).getTime() >= this.token_expiration.getTime()) {
            this.log.info("Access token expired; fetching a new one")
            this.invalidateToken();
            if (endpoint != "passport/login")
                //get new token
                await this.authenticate()
        }

        this.log.debug(`API.request(): method: ${method} endpoint: ${endpoint} baseUrl: ${this.api_base} token: ${this.token} data: ${JSON.stringify(data)} headers: ${JSON.stringify(this.headers)}`);
        const response = await axios({
            method: method,
            url: endpoint,
            data: data,
            headers: headers,
            baseURL: this.api_base,
            validateStatus: function (status) {
                return status < 500; // Resolve only if the status code is less than 500
            }
        });

        if (response.status == 401) {
            this.invalidateToken();
            this.log.error(`API.request(): Status return code 401, invalidate token (status: ${response.status} text: ${response.statusText}`);
            this.emit("not_connected");
        }

        return response;
    }

    public async checkPushToken(): Promise<boolean> {
        //Check push notification token
        try {
            const response = await this.request("post", "/app/review/app_push_check", {
                app_type: "eufySecurity",
                transaction: `${new Date().getTime()}`
            }, this.headers).catch(error => {
                this.log.error(`API.checkPushToken(): error: ${JSON.stringify(error)}`);
                return error;
            });
            this.log.debug(`API.checkPushToken(): Response: ${JSON.stringify(response.data)}`);

            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == 0) {
                    this.log.debug(`API.checkPushToken(): OK`);
                    return true;
                } else
                    this.log.error(`API.checkPushToken(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
            } else if (response.status == 401) {
                this.invalidateToken();
                this.log.error(`API.checkPushToken(): Status return code 401, invalidate token (status: ${response.status} text: ${response.statusText}`);
            } else {
                this.log.error(`API.checkPushToken(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.checkPushToken(): error: ${error}`);
        }
        return false;
    }

    public async registerPushToken(token: string): Promise<boolean> {
        //Register push notification token
        try {
            const response = await this.request("post", "/apppush/register_push_token", {
                is_notification_enable: true,
                token: token,
                transaction: `${new Date().getTime().toString()}`
            }, this.headers).catch(error => {
                this.log.error(`API.registerPushToken(): error: ${JSON.stringify(error)}`);
                return error;
            });
            this.log.debug(`API.registerPushToken(): Response: ${JSON.stringify(response.data)}`);

            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == 0) {
                    this.log.debug(`API.registerPushToken(): OK`);
                    return true;
                } else
                    this.log.error(`API.registerPushToken(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
            } else if (response.status == 401) {
                this.invalidateToken();
                this.log.error(`API.registerPushToken(): Status return code 401, invalidate token (status: ${response.status} text: ${response.statusText}`);
            } else {
                this.log.error(`API.registerPushToken(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.registerPushToken(): error: ${error}`);
        }
        return false;
    }

    public async setParameters(station_sn: string, device_sn: string, params: IParameter[]): Promise<boolean> {
        const tmp_params: any[] = []
        params.forEach(param => {
            tmp_params.push({ param_type: param.param_type, param_value: Parameter.writeValue(param.param_type, param.param_value) });
        });

        try {
            const response = await this.request("post", "app/upload_devs_params", {
                device_sn: device_sn,
                station_sn: station_sn,
                params: tmp_params
            }).catch(error => {
                this.log.error(`API.setParameters(): error: ${JSON.stringify(error)}`);
                return error;
            });
            this.log.debug(`API.setParameters(): station_sn: ${station_sn} device_sn: ${device_sn} params: ${JSON.stringify(tmp_params)} Response: ${JSON.stringify(response.data)}`);

            if (response.status == 200) {
                const result: ResultResponse = response.data;
                if (result.code == 0) {
                    const dataresult = result.data;
                    this.log.debug(`API.setParameters(): New Parameters set. response: ${JSON.stringify(dataresult)}`);
                    return true;
                } else
                    this.log.error(`API.setParameters(): Response code not ok (code: ${result.code} msg: ${result.msg})`);
            } else {
                this.log.error(`API.setParameters(): Status return code not 200 (status: ${response.status} text: ${response.statusText}`);
            }
        } catch (error) {
            this.log.error(`API.setParameters(): error: ${error}`);
        }
        return false;
    }

    public getLog(): ioBroker.Logger {
        return this.log;
    }

    public getDevices(): FullDevices {
        return this.devices;
    }

    public getHubs(): Hubs {
        return this.hubs;
    }

    public getToken(): string|null {
        return this.token;
    }

    public getTokenExpiration(): Date|null {
        return this.token_expiration;
    }

    public getTrustedTokenExpiration(): Date {
        return this.trusted_token_expiration;
    }

    public setToken(token: string): void {
        this.token = token;
        axios.defaults.headers.common["X-Auth-Token"] = token;
    }

    public setTokenExpiration(token_expiration: Date): void {
        this.token_expiration = token_expiration;
    }

    public getAPIBase(): string {
        return this.api_base;
    }

    public setAPIBase(api_base: string): void {
        this.api_base = api_base;
    }

    public setOpenUDID(openudid: string): void {
        this.headers.openudid = openudid;
    }

    public setSerialNumber(serialnumber: string): void {
        this.headers.sn = serialnumber;
    }

}