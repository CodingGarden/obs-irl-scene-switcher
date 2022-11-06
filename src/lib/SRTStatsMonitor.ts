import { ref, computed } from 'vue';
import type SRTStats from '@/interfaces/SRTStats';

export interface SRTStatsMonitorSettings {
  statsUrl: string;
  streamId: string;
}

export default class SRTStatsMonitor {
  settings: SRTStatsMonitorSettings | undefined;

  pktRcvDrops = ref<number[]>([]);

  pktRcvLosses = ref<number[]>([]);

  currentStatsTime = ref<Date | null>(null);

  currentStats = ref<SRTStats | null>(null);

  constructor(settings?: SRTStatsMonitorSettings) {
    this.settings = settings;
  }

  avgPktRcvDrops = computed(
    () => this.pktRcvDrops.value.length
      && Math.floor(this.pktRcvDrops.value.reduce((sum, value) => sum + value, 0)
        / this.pktRcvDrops.value.length),
  );

  avgPktRcvLosses = computed(
    () => this.pktRcvLosses.value.length
      && Math.floor(this.pktRcvLosses.value.reduce((sum, value) => sum + value, 0)
        / this.pktRcvLosses.value.length),
  );

  currentPublisher = computed(
    () => this.settings
      && this.currentStats.value?.publishers[this.settings.streamId],
  );

  async getNextStats() {
    if (!this.settings) return;
    const response = await fetch(this.settings.statsUrl);
    const nextStats: SRTStats = await response.json();
    const nextStatsPublisher = nextStats.publishers[this.settings.streamId];
    if (nextStatsPublisher && this.currentPublisher.value) {
      this.pktRcvDrops.value.unshift(
        nextStatsPublisher.pktRcvDrop - this.currentPublisher.value.pktRcvDrop,
      );
      this.pktRcvLosses.value.unshift(
        nextStatsPublisher.pktRcvLoss - this.currentPublisher.value.pktRcvLoss,
      );
      this.pktRcvDrops.value = this.pktRcvDrops.value.slice(0, 3);
      this.pktRcvLosses.value = this.pktRcvLosses.value.slice(0, 3);
    } else {
      this.pktRcvDrops.value = [];
      this.pktRcvLosses.value = [];
    }
    this.currentStatsTime.value = new Date();
    this.currentStats.value = nextStats;
  }

  clear() {
    this.currentStatsTime.value = null;
    this.currentStats.value = null;
    this.pktRcvDrops.value = [];
    this.pktRcvLosses.value = [];
  }
}
