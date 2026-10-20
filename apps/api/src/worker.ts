import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // createApplicationContext already initialized the context (processors are running).
  // On SIGTERM, BullMQ workers stop taking new jobs and finish the active ones before exit.
  app.enableShutdownHooks();
}

void bootstrap();
