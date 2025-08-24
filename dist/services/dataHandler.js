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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDataUsageSync = startDataUsageSync;
const child_process_1 = require("child_process");
const util_1 = require("util");
const mainServerClient_1 = __importDefault(require("./mainServerClient"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class DataUsageSync {
    constructor() {
        this.contractId = process.env.CONTRACT_ID || '';
    }
    getActiveSessions() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield mainServerClient_1.default.get(`/api/portal/sessions/active?contractId=${this.contractId}`);
                const data = response.data;
                if (data.success) {
                    return data.data.sessions;
                }
                else {
                    console.error('Failed to get active sessions:', data.error);
                    return [];
                }
            }
            catch (error) {
                console.error('Error fetching active sessions:', error);
                return [];
            }
        });
    }
    syncDataUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log('Starting data usage sync...');
                const activeSessions = yield this.getActiveSessions();
                if (activeSessions.length === 0) {
                    console.log('No active sessions to sync');
                    return;
                }
                console.log(`Found ${activeSessions.length} active sessions to sync`);
                const sessionUpdates = [];
                for (const session of activeSessions) {
                    const dataUsage = yield this.getDataUsageByIP(session.userIP, session.sessionId);
                    console.log(dataUsage);
                    if (dataUsage) {
                        sessionUpdates.push({
                            sessionId: session.sessionId,
                            userIP: session.userIP,
                            dataUsage
                        });
                    }
                }
                if (sessionUpdates.length === 0) {
                    console.log('No data usage updates to send');
                    return;
                }
                console.log(`Preparing to send`, sessionUpdates);
                const response = yield mainServerClient_1.default.put(`/api/portal/sessions/update-data-usage`, {
                    sessionUpdates,
                });
                console.log(`Sending ${sessionUpdates.length} data usage updates to main server`);
                const result = response.data;
                if (result.success) {
                    console.log(`Successfully updated ${result.data.successCount} sessions`);
                    if (result.data.errorCount > 0) {
                        console.log(`${result.data.errorCount} updates failed:`, result.data.errors);
                    }
                }
                else {
                    console.error('Failed to update data usage:', result.error);
                }
            }
            catch (error) {
                console.error('Error syncing data usage:', error);
            }
        });
    }
    getDataUsageByIP(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                const cmd = `sudo /sbin/iptables -L FORWARD -n -v -x | grep -E "(${downloadComment}|${uploadComment})"`;
                const result = yield execAsync(cmd);
                let downloadBytes = 0;
                let uploadBytes = 0;
                if (result.stdout.trim()) {
                    result.stdout.split('\n').forEach(line => {
                        const trimmedLine = line.trim();
                        if (!trimmedLine)
                            return;
                        const columns = trimmedLine.split(/\s+/);
                        if (columns.length >= 2) {
                            const bytes = parseInt(columns[1]) || 0;
                            if (trimmedLine.includes(downloadComment)) {
                                downloadBytes = bytes;
                            }
                            if (trimmedLine.includes(uploadComment)) {
                                uploadBytes = bytes;
                            }
                        }
                    });
                }
                return {
                    downloadBytes,
                    uploadBytes,
                    totalBytes: downloadBytes + uploadBytes,
                    lastUpdated: new Date(),
                };
            }
            catch (error) {
                console.error(`Error getting data usage for IP ${userIP}:`, error);
                return null;
            }
        });
    }
    /**
   * Collect system metrics
   */
    collectSystemMetrics() {
        return __awaiter(this, void 0, void 0, function* () {
            const metrics = {
                timestamp: new Date(),
                cpuUsage: yield this.getCPUUsage(),
                memoryUsage: yield this.getMemoryUsage(),
                temperature: yield this.getTemperature(),
                diskUsage: yield this.getDiskUsage(),
                uptime: yield this.getSystemUptime(),
            };
            return metrics;
        });
    }
    /**
     * Get CPU usage percentage
     */
    getCPUUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { stdout } = yield execAsync(`top -bn1 | grep '%Cpu' | awk '{print 100 - $8}'`);
                return parseFloat(stdout.trim()) || 0;
            }
            catch (_a) {
                return 0;
            }
        });
    }
    /**
     * Get memory usage percentage
     */
    getMemoryUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { stdout } = yield execAsync(`
        awk '/MemTotal|MemAvailable/' /proc/meminfo | 
        awk 'NR==1{total=$2} NR==2{available=$2} END{print (total-available)*100/total}'
      `);
                if (stdout.trim()) {
                    return parseFloat(stdout.trim()) || 0;
                }
                // Fallback to 'free' if meminfo fails
                const { stdout: freeOut } = yield execAsync(`
        free | awk '/^Mem:/ {printf "%.1f", ($3/$2) * 100.0}'
      `);
                return parseFloat(freeOut.trim()) || 0;
            }
            catch (error) {
                console.error("Error getting memory usage:", error);
                return 0;
            }
        });
    }
    /**
     * Get system temperature
     */
    getTemperature() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Try Raspberry Pi first
                const { stdout: vcgencmdOut } = yield execAsync(`which vcgencmd && vcgencmd measure_temp | egrep -o '[0-9]*\\.[0-9]*'`);
                if (vcgencmdOut.trim()) {
                    return parseFloat(vcgencmdOut.trim()) || 0;
                }
                // Fallback for other systems
                const { stdout } = yield execAsync(`cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{print $1/1000}'`);
                return parseFloat(stdout.trim()) || 0;
            }
            catch (_a) {
                return 0;
            }
        });
    }
    /**
     * Get disk usage percentage
     */
    getDiskUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { stdout } = yield execAsync(`df -h / | awk 'NR==2{print $5}' | sed 's/%//'`);
                return parseFloat(stdout.trim()) || 0;
            }
            catch (_a) {
                return 0;
            }
        });
    }
    /**
     * Get system uptime in seconds
     */
    getSystemUptime() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { stdout } = yield execAsync(`awk '{print $1}' /proc/uptime`);
                return parseFloat(stdout.trim()) || 0;
            }
            catch (_a) {
                return 0;
            }
        });
    }
    /**
     * Send system metrics to main server
     */
    syncSystemMetrics() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const systemMetrics = yield this.collectSystemMetrics();
                const response = yield mainServerClient_1.default.put(`/api/portal/sessions/update-system-metrics`, {
                    contractId: this.contractId,
                    systemMetrics
                });
                const result = yield response.data;
                if (result.success) {
                    console.log(`System metrics updated for ${result.data.sessionsUpdated} sessions`);
                }
                else {
                    console.error('Failed to update system metrics:', result.error);
                }
            }
            catch (error) {
                console.error('Error syncing system metrics:', error);
            }
        });
    }
    /**
     * Combined sync function for both data usage and system metrics
     */
    syncAll() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log('Starting comprehensive sync...');
                // Sync data usage and system metrics in parallel
                yield Promise.all([
                    this.syncDataUsage(),
                    this.syncSystemMetrics()
                ]);
                console.log('Comprehensive sync completed');
            }
            catch (error) {
                console.error('Error in comprehensive sync:', error);
            }
        });
    }
}
// Function to start the sync interval
function startDataUsageSync() {
    const dataSync = new DataUsageSync();
    setInterval(() => __awaiter(this, void 0, void 0, function* () {
        yield dataSync.syncAll();
    }), 60000);
    console.log('Data usage sync started, running every 60 seconds');
}
