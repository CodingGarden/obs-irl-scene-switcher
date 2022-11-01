<script setup lang="ts">
import {
  onMounted, reactive, ref, watch,
} from 'vue';
import OBSWebSocket from 'obs-websocket-js';
import type OBSScene from '@/interfaces/OBSScene';
import reactiveFromLocalStorage from '@/lib/reactiveLocalStorage';
import type SRTStats from '@/interfaces/SRTStats';

const connectError = ref('');
const connectionSettings = reactiveFromLocalStorage('connectionSettings', {
  port: 4455,
  password: '',
});
const sceneSwitchSettings = reactiveFromLocalStorage('sceneSwitchSettings', {
  mainSceneName: '',
  lowBitrateSceneName: '',
  beRightBackSceneName: '',
  lowBitrateThreshold: 1000,
  sceneSwitchDelayMS: 3500,
});
const obsState = reactive({
  connected: false,
  currentSceneName: '',
  scenes: [] as OBSScene[],
});
const srtPolling = ref(false);
const srtLiveServerSettings = reactiveFromLocalStorage(
  'srtLiveServerSettings',
  {
    statsUrl: 'http://localhost:8181/stats',
    pollRateMS: 5000,
    streamId: 'publish/live/feed1',
  },
);

watch(sceneSwitchSettings, () => {
  localStorage.setItem(
    'sceneSwitchSettings',
    JSON.stringify(sceneSwitchSettings),
  );
});
watch(srtLiveServerSettings, () => {
  localStorage.setItem(
    'srtLiveServerSettings',
    JSON.stringify(srtLiveServerSettings),
  );
});

const obs = new OBSWebSocket();

obs.on('ConnectionClosed', () => {
  obsState.connected = false;
});
obs.on('ConnectionError', () => {
  obsState.connected = false;
});

async function connect() {
  try {
    connectError.value = '';
    await obs.connect(
      `ws://127.0.0.1:${connectionSettings.port}`,
      connectionSettings.password || undefined,
    );
    localStorage.setItem(
      'connectionSettings',
      JSON.stringify(connectionSettings),
    );
    const updateState = async () => {
      const sceneList = await obs.call('GetSceneList');
      obsState.currentSceneName = sceneList.currentProgramSceneName;
      obsState.scenes = sceneList.scenes as unknown as OBSScene[];
      obsState.connected = true;
    };
    updateState();
    obs.on('CurrentProgramSceneChanged', updateState);
    obs.on('SceneNameChanged', updateState);
    obs.on('SceneCreated', updateState);
    obs.on('SceneRemoved', updateState);
  } catch (error) {
    connectError.value = (error as Error).message;
    obsState.connected = false;
  }
}

async function disconnect() {
  await obs.disconnect();
  obsState.connected = false;
}

onMounted(() => {
  if (localStorage.getItem('connectionSettings')) {
    connect();
  }
});

async function getSRTStats() {
  const response = await fetch(srtLiveServerSettings.statsUrl);
  const stats = (await response.json()) as SRTStats;
  if (
    Object.hasOwn(stats.publishers, srtLiveServerSettings.streamId)
    && [
      sceneSwitchSettings.lowBitrateSceneName,
      sceneSwitchSettings.mainSceneName,
      sceneSwitchSettings.beRightBackSceneName,
    ].includes(obsState.currentSceneName)
  ) {
    if (
      stats.publishers[srtLiveServerSettings.streamId].bitrate
      <= sceneSwitchSettings.lowBitrateThreshold
    ) {
      if (
        obsState.currentSceneName !== sceneSwitchSettings.lowBitrateSceneName
      ) {
        obs.call('SetCurrentProgramScene', {
          sceneName: sceneSwitchSettings.lowBitrateSceneName,
        });
      }
    } else if (
      obsState.currentSceneName !== sceneSwitchSettings.mainSceneName
    ) {
      setTimeout(() => {
        obs.call('SetCurrentProgramScene', {
          sceneName: sceneSwitchSettings.mainSceneName,
        });
      }, sceneSwitchSettings.sceneSwitchDelayMS);
    }
  } else if (
    [
      sceneSwitchSettings.lowBitrateSceneName,
      sceneSwitchSettings.mainSceneName,
    ].includes(obsState.currentSceneName)
    && obsState.currentSceneName !== sceneSwitchSettings.beRightBackSceneName
  ) {
    await obs.call('SetCurrentProgramScene', {
      sceneName: sceneSwitchSettings.beRightBackSceneName,
    });
  }
  if (srtPolling.value) {
    setTimeout(getSRTStats, srtLiveServerSettings.pollRateMS);
  }
}

function startSRTPolling() {
  srtPolling.value = true;
  getSRTStats();
}

function stopSRTPolling() {
  srtPolling.value = false;
}
</script>

<template>
  <div class="container panel">
    <form v-if="!obsState.connected" @submit.prevent="connect()">
      <article class="error" v-if="connectError">{{ connectError }}</article>
      <label for="port">Port</label>
      <input
        v-model="connectionSettings.port"
        id="port"
        type="number"
        min="1024"
        max="65535"
      />
      <label for="password">Password</label>
      <input
        v-model="connectionSettings.password"
        id="password"
        type="password"
      />
      <button type="submit">CONNECT</button>
    </form>
    <button
      @click="disconnect()"
      v-if="obsState.connected"
      type="button"
      class="secondary outline"
    >
      DISCONNECT
    </button>
    <div v-if="obsState.connected">
      <details>
        <summary>SRT Settings</summary>
        <div>
          <label for="srtStatsUrl">SRT Stats Url</label>
          <input
            :disabled="srtPolling"
            id="srtStatsUrl"
            v-model="srtLiveServerSettings.statsUrl"
          />
          <label for="pollRateMS">SRT Stats Poll Rate in ms</label>
          <input
            :disabled="srtPolling"
            id="pollRateMS"
            v-model="srtLiveServerSettings.pollRateMS"
            type="number"
            min="500"
          />
          <label for="streamId">SRT Stream ID</label>
          <input
            :disabled="srtPolling"
            id="streamId"
            v-model="srtLiveServerSettings.streamId"
          />
        </div>
      </details>
      <details>
        <summary>Scene Settings</summary>
        <div>
          <label for="mainSceneName">Main Scene</label>
          <select
            v-model="sceneSwitchSettings.mainSceneName"
            id="mainSceneName"
          >
            <option v-for="scene in obsState.scenes" :key="scene.sceneName">
              {{ scene.sceneName }}
            </option>
          </select>
          <label for="beRightBackSceneName">Be Right Back Scene</label>
          <select
            v-model="sceneSwitchSettings.beRightBackSceneName"
            id="beRightBackSceneName"
          >
            <option v-for="scene in obsState.scenes" :key="scene.sceneName">
              {{ scene.sceneName }}
            </option>
          </select>
          <label for="sceneSwitchDelayMS">Scene Switch Delay in ms</label>
          <input
            v-model="sceneSwitchSettings.sceneSwitchDelayMS"
            id="sceneSwitchDelayMS"
            type="number"
          />
          <hr />
          <label for="lowBitrateSceneName">Low Bitrate Scene</label>
          <select
            v-model="sceneSwitchSettings.lowBitrateSceneName"
            id="lowBitrateSceneName"
          >
            <option v-for="scene in obsState.scenes" :key="scene.sceneName">
              {{ scene.sceneName }}
            </option>
          </select>
          <label for="lowBitrateThreshold">Low Bitrate Threshold</label>
          <input
            v-model="sceneSwitchSettings.lowBitrateThreshold"
            id="lowBitrateThreshold"
            type="number"
          />
        </div>
      </details>
      <button
        @click="startSRTPolling()"
        v-if="!srtPolling"
        type="button"
        class="outline"
        :disabled="!srtLiveServerSettings.statsUrl"
      >
        START
      </button>
      <button v-else @click="stopSRTPolling()" type="button" class="outline">
        STOP
      </button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  margin-top: 1rem;
}

.error {
  background: var(--del-color);
}
</style>
