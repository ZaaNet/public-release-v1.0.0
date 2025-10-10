"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetfilterTrafficMonitor = void 0;
const child_process_1 = require("child_process");
const child_process_2 = require("child_process");
const util_1 = require("util");
const path_1 = require("path");
const execAsync = (0, util_1.promisify)(child_process_2.exec);
class NetfilterTrafficMonitor {
    constructor() {
        this.stats = new Map();
        this.isRunning = false;
        this.scriptPath = (0, path_1.join)(__dirname, 'packet_monitor.py');
    }
    startMonitoring() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isRunning) {
                return;
            }
            // Kill any existing processes
            try {
                yield execAsync('sudo pkill -9 -f packet_monitor');
                yield new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (_a) {
                // Ignore if no process was found
            }
            // Start Python process (iptables rule already exists from bash script)
            this.pythonProcess = (0, child_process_1.spawn)('sudo', ['python3', this.scriptPath]);
            this.pythonProcess.stdout.on('data', (data) => {
                try {
                    const output = data.toString().trim();
                    const lines = output.split('\n').filter(line => line.trim());
                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            const stats = parsed.stats || parsed;
                            this.updateStats(stats);
                            console.log(`Updated stats: ${this.stats.size} IPs tracked`);
                        }
                        catch (parseError) {
                            // Not JSON, skip (probably status message)
                        }
                    }
                }
                catch (error) {
                    console.error('Error handling Python output:', error);
                }
            });
            this.pythonProcess.stderr.on('data', (data) => {
                console.error('Python:', data.toString().trim());
            });
            this.pythonProcess.on('error', (error) => {
                console.error('Python process error:', error);
                this.isRunning = false;
            });
            this.pythonProcess.on('exit', (code, signal) => {
                this.isRunning = false;
            });
            this.isRunning = true;
        });
    }
    updateStats(newStats) {
        for (const [ip, data] of Object.entries(newStats)) {
            this.stats.set(ip, data);
        }
    }
    getStatsForIP(ip) {
        const stats = this.stats.get(ip);
        // if (!stats) {
        //     return { upload: 0, download: 0 };
        // }
        return stats;
    }
    stopMonitoring() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.pythonProcess) {
                this.pythonProcess.kill('SIGTERM');
            }
            this.isRunning = false;
            // Note: Don't remove iptables rule here - it's managed by bash script
        });
    }
}
exports.NetfilterTrafficMonitor = NetfilterTrafficMonitor;
