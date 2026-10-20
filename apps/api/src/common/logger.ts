import { LoggerModule } from 'nestjs-pino';
import { loadConfig } from '../config/app-config';

/** Structured JSON logs in production, pretty logs locally. Shared by the API and the worker. */
export const loggerModule = () => {
  const config = loadConfig();
  return LoggerModule.forRoot({
    pinoHttp: {
      level: config.logLevel,
      transport: config.env === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      autoLogging: { ignore: (req) => req.url === '/health' },
    },
  });
};
