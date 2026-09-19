"use strict";

const mineflayer = require("mineflayer");
const { addLog } = require("./logger");

class ServerBot {
  constructor(config) {
    this.config = config;
    this.bot = null;
    this.status = "stopped";
    this.startedAt = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.intervals = [];
    this.manualStop = false;
    this.lastError = null;
  }

  log(message) {
    const prefix = `[${this.config.name || this.config.id}]`;
    addLog(`${prefix} ${message}`);
  }

  getStatus() {
    const position =
      this.bot && this.bot.entity
        ? {
            x: Math.floor(this.bot.entity.position.x),
            y: Math.floor(this.bot.entity.position.y),
            z: Math.floor(this.bot.entity.position.z)
          }
        : null;

    return {
      id: this.config.id,
      name: this.config.name,
      host: this.config.host,
      port: this.config.port,
      status: this.status,
      username: this.config.botUsername,
      position,
      startedAt: this.startedAt,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError
    };
  }

  start() {
    if (this.status === "online" || this.status === "connecting") {
      return false;
    }

    this.manualStop = false;
    this.lastError = null;
    this.status = "connecting";
    this.startedAt = Date.now();

    this.log(
      `Connecting to ${this.config.host}:${this.config.port || 25565}`
    );

    const botOptions = {
      username: this.config.botUsername,
      host: this.config.host,
      port: Number(this.config.port || 25565),
      auth: this.config.authType || "offline",
      password: this.config.botPassword || undefined,
      version:
        this.config.version && this.config.version.trim() !== ""
          ? this.config.version
          : false,
      hideErrors: false,
      checkTimeoutInterval: 600000
    };

    try {
      this.bot = mineflayer.createBot(botOptions);
      this.registerEvents();
      return true;
    } catch (error) {
      this.status = "error";
      this.lastError = error.message;
      this.log(`Failed to create bot: ${error.message}`);
      this.scheduleReconnect();
      return false;
    }
  }

  registerEvents() {
    if (!this.bot) return;

    this.bot.once("spawn", () => {
      this.status = "online";
      this.reconnectAttempts = 0;
      this.lastError = null;

      this.log(`Connected successfully as ${this.bot.username}`);
      this.setupFeatures();
    });

    this.bot.on("chat", (username, message) => {
      if (username !== this.bot.username) {
        this.log(`[Chat] ${username}: ${message}`);
      }
    });

    this.bot.on("messagestr", (message) => {
      this.log(`[Message] ${message}`);

      if (
        this.config.autoAuth &&
        this.config.autoAuth.enabled &&
        this.config.autoAuth.password
      ) {
        const lowerMessage = String(message).toLowerCase();
        const password = this.config.autoAuth.password;

        if (
          lowerMessage.includes("/login") ||
          lowerMessage.includes("login")
        ) {
          this.bot.chat(`/login ${password}`);
          this.log("Login command sent");
        }

        if (
          lowerMessage.includes("/register") ||
          lowerMessage.includes("register")
        ) {
          this.bot.chat(`/register ${password} ${password}`);
          this.log("Register command sent");
        }
      }
    });

    this.bot.on("kicked", (reason) => {
      const text =
        typeof reason === "object" ? JSON.stringify(reason) : String(reason);

      this.lastError = text;
      this.status = "offline";
      this.log(`Kicked: ${text}`);
    });

    this.bot.on("error", (error) => {
      this.lastError = error.message;
      this.status = "error";
      this.log(`Error: ${error.message}`);
    });

    this.bot.on("end", (reason) => {
      this.clearIntervals();
      this.status = "offline";

      this.log(`Disconnected: ${reason || "unknown reason"}`);

      if (!this.manualStop && this.config.autoReconnect !== false) {
        this.scheduleReconnect();
      }
    });
  }

  setupFeatures() {
    if (!this.bot) return;

    const antiAfk = this.config.antiAfk || {};
    const chatMessages = this.config.chatMessages || {};

    if (antiAfk.enabled) {
      if (antiAfk.sneak && typeof this.bot.setControlState === "function") {
        this.bot.setControlState("sneak", true);
      }

      if (antiAfk.lookAround) {
        this.addInterval(() => {
          if (!this.bot || this.status !== "online") return;

          try {
            const yaw = Math.random() * Math.PI * 2 - Math.PI;
            const pitch = Math.random() * 0.5 - 0.25;
            this.bot.look(yaw, pitch, true);
          } catch (error) {
            this.log(`Look error: ${error.message}`);
          }
        }, 5000);
      }

      if (antiAfk.randomJump) {
        this.addInterval(() => {
          if (
            !this.bot ||
            this.status !== "online" ||
            typeof this.bot.setControlState !== "function"
          ) {
            return;
          }

          try {
            this.bot.setControlState("jump", true);

            setTimeout(() => {
              if (this.bot && typeof this.bot.setControlState === "function") {
                this.bot.setControlState("jump", false);
              }
            }, 300);
          } catch (error) {
            this.log(`Jump error: ${error.message}`);
          }
        }, 30000);
      }
    }

    if (
      chatMessages.enabled &&
      chatMessages.repeat &&
      Array.isArray(chatMessages.messages) &&
      chatMessages.messages.length > 0
    ) {
      let messageIndex = 0;
      const delay = Math.max(
        Number(chatMessages.repeatDelay || 120) * 1000,
        10000
      );

      this.addInterval(() => {
        if (!this.bot || this.status !== "online") return;

        const message = chatMessages.messages[messageIndex];
        this.bot.chat(message);

        messageIndex =
          (messageIndex + 1) % chatMessages.messages.length;
      }, delay);
    }
  }

  addInterval(callback, delay) {
    const interval = setInterval(callback, delay);
    this.intervals.push(interval);
    return interval;
  }

  clearIntervals() {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }

    this.intervals = [];
  }

  scheduleReconnect() {
    if (this.manualStop || this.reconnectTimer) return;

    this.reconnectAttempts += 1;

    const baseDelay = Number(this.config.reconnectDelay || 5000);
    const maxDelay = Number(this.config.maxReconnectDelay || 120000);

    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts - 1),
      maxDelay
    );

    this.log(`Reconnecting in ${Math.ceil(delay / 1000)} seconds`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  stop() {
    this.manualStop = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.clearIntervals();

    if (this.bot) {
      try {
        this.bot.quit("Stopped from dashboard");
      } catch (_) {
        try {
          this.bot.end();
        } catch (_) {}
      }

      this.bot = null;
    }

    this.status = "stopped";
    this.log("Stopped manually");

    return true;
  }

  restart() {
    this.stop();

    setTimeout(() => {
      this.start();
    }, 1000);

    return true;
  }

  sendCommand(command) {
    if (!this.bot || this.status !== "online") {
      return {
        success: false,
        message: "Bot is not connected"
      };
    }

    const value = String(command || "").trim();

    if (!value) {
      return {
        success: false,
        message: "Command cannot be empty"
      };
    }

    try {
      if (value.startsWith("/")) {
        this.bot.chat(value);
      } else {
        this.bot.chat(value);
      }

      this.log(`[Console] ${value}`);

      return {
        success: true,
        message: `Sent: ${value}`
      };
    } catch (error) {
      this.lastError = error.message;

      return {
        success: false,
        message: error.message
      };
    }
  }
}

class ServerManager {
  constructor(servers) {
    this.bots = new Map();

    for (const server of servers) {
      if (!server.id) {
        throw new Error("Every server must have a unique id");
      }

      this.bots.set(server.id, new ServerBot(server));
    }
  }

  get(id) {
    return this.bots.get(id);
  }

  list() {
    return Array.from(this.bots.values()).map((bot) => bot.getStatus());
  }

  start(id) {
    const bot = this.get(id);

    if (!bot) {
      return {
        success: false,
        message: "Server not found"
      };
    }

    return {
      success: bot.start(),
      message: `Start requested for ${bot.config.name || id}`
    };
  }

  stop(id) }

    return {
      success: bot.stop(),
      message: `Stop requested for ${bot.config.name || id}`
    };
  }

  restart(id) {
    const bot = this.get(id);

    if (!bot) {
      return {
        success: false,
        message: "Server not found"
      };
    }

    return {
      success: bot.restart(),
      message: `Restart requested for ${bot.config.name || id}`
    };
  }

  command(id, command) {
    const bot = this.get(id);

    if (!bot) {
      return {
        success: false,
        message: "Server not found"
      };
    }

    return bot.sendCommand(command);
  }

  startAutoServers() {
    for (const bot of this.bots.values()) {
      if (bot.config.autoStart) {
        bot.start();
      }
    }
  }

  stopAll() {
    for (const bot of this.bots.values()) {
      bot.stop();
    }
  }
}

module.exports = {
  ServerBot,
  ServerManager
};