import nodemailer from 'nodemailer';
import { config } from '../config.js';

const { smtp } = config;
const transport = smtp.host
  ? nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

// Without SMTP configured (dev/tests) emails are kept here and printed to the console instead of sent.
export const outbox = [];

export async function sendMail({ to, subject, text }) {
  if (!transport) {
    outbox.push({ to, subject, text });
    if (!config.isTest) console.log(`\n=== EMAIL (SMTP not configured, not sent) ===\nTo: ${to}\nSubject: ${subject}\n\n${text}\n=============================================\n`);
    return;
  }
  await transport.sendMail({ from: config.mailFrom, to, subject, text });
}

export async function verifyMail() {
  if (!transport) return console.log('SMTP not configured: emails will be printed to this console instead of sent.');
  try {
    await transport.verify();
    console.log(`SMTP ready (${smtp.host}:${smtp.port})`);
  } catch (err) {
    if (config.isProd) throw new Error(`SMTP check failed: ${err.message}`);
    console.warn(`SMTP check failed (${err.message}); emails will fail to send.`);
  }
}
