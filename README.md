# backend-reverse-proxy

Intended for accessing web applications running on development machines at localhost from mobile devices.

In general, serves as an HTTP reverse proxy.

Works together with [backend-local-forward-proxy](https://github.com/aaronicsubstances/backend-local-forward-proxy) through long polling. So mobile device makes HTTP requests to running instance of this project, which then gets transferred to [backend-local-forward-proxy](https://github.com/aaronicsubstances/backend-local-forward-proxy) for delivery to actual target web appliation.

## Setup

Launch with 
```
npm start
```

See .env.sample for environment variables which can be used to configure the application. The most important of them are

   * REQUEST_TIMEOUT_MILLIS. default is 20 seconds.
   * POLL_WAIT_TIME_MILLIS. default is 5 seconds.

**In general, it is expected that this project will be hosted on the internet so that mobile devices can assess it.**

One can however, leverage networking expertise to run project locally and avoid deployment to internet, by getting mobile device and development PC to be on the same network. In that case the mobile device can use the IP address assigned to the development PC to assess web applications running on it directly.

One case scenario verified by author is where the development PC uses internet through mobile device's WiFi hotspot. The mobile device then connects directly to the PC using the IP it has assigned the PC, and then web applications are available on the mobile device.

*Once again deployment to the internet is required in general of this project to fulfill its goals.*