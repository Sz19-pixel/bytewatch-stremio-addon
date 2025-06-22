const { createLogger, transports, format } = require("winston");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.colorize(),
    format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new transports.Console(),
    // Uncomment the following line if you want file logs locally:
    // new transports.File({ filename: 'logs/app.log', level: 'debug' })
  ],
});

module.exports = logger;
