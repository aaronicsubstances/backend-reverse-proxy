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

