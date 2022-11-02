<script setup lang="ts">
import {
  onMounted, reactive, ref,
} from 'vue';
import OBSWebSocket from 'obs-websocket-js';
import * as tmi from 'tmi.js';

import type OBSScene from '@/interfaces/OBSScene';
import reactiveFromLocalStorage from '@/lib/reactiveLocalStorage';
import type SRTStats from '@/interfaces/SRTStats';

let client = new tmi.Client({});

const connectError = ref('');
const connectionSettings = reactiveFromLocalStorage({
  key: 'connectionSettings',
  initialValue: {
    host: 'localhost',
    port: 4455,
    password: '',
  },
});
const sceneSwitchSettings = reactiveFromLocalStorage({
  key: 'sceneSwitchSettings',
  initialValue: {
    mainSceneName: '',
    lowBitrateSceneName: '',
    beRightBackSceneName: '',
    lowBitrateThreshold: 1000,
    sceneSwitchDelaySeconds: 3.5,
  },
  watchValue: true,
});
const obsState = reactive({
  connected: false,
  currentSceneName: '',
  scenes: [] as OBSScene[],
});
const srtPolling = ref(false);
const srtLiveServerSettings = reactiveFromLocalStorage({
  key: 'srtLiveServerSettings',
  initialValue: {
    statsUrl: 'http://localhost:8181/stats',
    pollRateSeconds: 1,
    streamId: 'publish/live/feed1',
  },
  watchValue: true,
});

const botSettings = reactiveFromLocalStorage({
  key: 'botSettings',
  initialValue: {
    botName: '',
    oauthToken: '',
    channelName: '',
    enabled: false,
    permissions: {
      moderator: true,
      public: false,
    },
  },
  watchValue: true,
});

const obs = new OBSWebSocket();

obs.on('ConnectionClosed', () => {
  obsState.connected = false;
  srtPolling.value = false;
});
obs.on('ConnectionError', () => {
  obsState.connected = false;
  srtPolling.value = false;
});

async function connect() {
  try {
    connectError.value = '';
    await obs.connect(
      `ws://${connectionSettings.host}:${connectionSettings.port}`,
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

let stats: SRTStats | null = null;
async function getSRTStats() {
  if (!srtPolling.value) return;
  const response = await fetch(srtLiveServerSettings.statsUrl);
  stats = (await response.json()) as SRTStats;
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
      < sceneSwitchSettings.lowBitrateThreshold
    ) {
      if (
        obsState.currentSceneName !== sceneSwitchSettings.lowBitrateSceneName
      ) {
        obs.call('SetCurrentProgramScene', {
          sceneName: sceneSwitchSettings.lowBitrateSceneName,
        });
        client.say(botSettings.channelName, 'Low Bitrate Detected: Switching to "Low Bitrate" Scene');
      }
    } else if (
      obsState.currentSceneName !== sceneSwitchSettings.mainSceneName
    ) {
      obsState.currentSceneName = sceneSwitchSettings.mainSceneName;
      setTimeout(() => {
        obs.call('SetCurrentProgramScene', {
          sceneName: sceneSwitchSettings.mainSceneName,
        });
        client.say(botSettings.channelName, 'Connected! Switching to "Main" Scene');
      }, sceneSwitchSettings.sceneSwitchDelaySeconds * 1000);
    }
  } else if (
    [
      sceneSwitchSettings.lowBitrateSceneName,
      sceneSwitchSettings.mainSceneName,
    ].includes(obsState.currentSceneName)
    && obsState.currentSceneName !== sceneSwitchSettings.beRightBackSceneName
  ) {
    obs.call('SetCurrentProgramScene', {
      sceneName: sceneSwitchSettings.beRightBackSceneName,
    });
    client.say(botSettings.channelName, 'Disconnected... Switching to "Be Right Back" Scene');
  }
  if (srtPolling.value) {
    setTimeout(getSRTStats, srtLiveServerSettings.pollRateSeconds * 1000);
  }
}

function sendBitrateInChat() {
  if (!srtPolling.value) return;
  if (stats && stats.publishers[srtLiveServerSettings.streamId]) {
    client.say(botSettings.channelName, `Current bitrate: ${stats?.publishers[srtLiveServerSettings.streamId].bitrate}`);
  }
  setTimeout(sendBitrateInChat, 60 * 1000);
}

function startSRTPolling() {
  srtPolling.value = true;
  if (botSettings.enabled) {
    client = new tmi.Client({
      identity: {
        username: botSettings.botName,
        password: botSettings.oauthToken.startsWith('oauth:') ? botSettings.oauthToken : `oauth:${botSettings.oauthToken}`,
      },
      channels: [botSettings.channelName],
    });
    client.addListener('message', (channel, userstate, message) => {
      const isModerator = userstate.badges?.moderator;
      const isPublicUser = !userstate.badges?.moderator && !userstate.badges?.broadcaster;
      if (!botSettings.permissions.public && isPublicUser) return;
      if (!botSettings.permissions.moderator && isModerator) return;
      if (message === '!bitrate') {
        if (stats && stats.publishers[srtLiveServerSettings.streamId]) {
          client.say(botSettings.channelName, `Current bitrate: ${stats?.publishers[srtLiveServerSettings.streamId].bitrate}`);
        } else {
          client.say(botSettings.channelName, 'Bitrate not available...');
        }
      } else if (message === '!scene' || message === '!currentscene') {
        client.say(botSettings.channelName, `Current scene: ${obsState.currentSceneName}`);
      }
    });
    client.connect();
    setTimeout(sendBitrateInChat, 60 * 1000);
  }
  getSRTStats();
}

function stopSRTPolling() {
  srtPolling.value = false;
  client.removeAllListeners();
  client.disconnect();
}
</script>

<template>
  <div class="container panel">
    <form v-if="!obsState.connected" @submit.prevent="connect()">
      <article class="error" v-if="connectError">{{ connectError }}</article>
      <label for="host">Host</label>
      <input
        v-model="connectionSettings.host"
        id="host"
      />
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
      DISCONNECT OBS
    </button>
    <div v-if="obsState.connected">
      <details>
        <summary>SRT Settings</summary>
        <div>
          <label for="srtStatsUrl">Stats URL</label>
          <input
            :disabled="srtPolling"
            id="srtStatsUrl"
            v-model="srtLiveServerSettings.statsUrl"
          />
          <label for="pollRateSeconds">Stats Poll Rate in Seconds</label>
          <input
            :disabled="srtPolling"
            id="pollRateSeconds"
            v-model="srtLiveServerSettings.pollRateSeconds"
            type="number"
            min="500"
          />
          <label for="streamId">Stream ID</label>
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
            <option v-for="scene in obsState.scenes" :key="scene.sceneName" :disabled="srtPolling">
              {{ scene.sceneName }}
            </option>
          </select>
          <label for="beRightBackSceneName">Be Right Back Scene</label>
          <select
            v-model="sceneSwitchSettings.beRightBackSceneName"
            id="beRightBackSceneName"
          >
            <option v-for="scene in obsState.scenes" :key="scene.sceneName" :disabled="srtPolling">
              {{ scene.sceneName }}
            </option>
          </select>
          <label for="sceneSwitchDelayMS">Scene Switch Delay in Seconds</label>
          <input
            v-model="sceneSwitchSettings.sceneSwitchDelaySeconds"
            :disabled="srtPolling"
            id="sceneSwitchDelaySeconds"
            type="number"
            min="0"
          />
          <hr />
          <label for="lowBitrateSceneName">Low Bitrate Scene</label>
          <select
            v-model="sceneSwitchSettings.lowBitrateSceneName"
            :disabled="srtPolling"
            id="lowBitrateSceneName"
          >
            <option v-for="scene in obsState.scenes" :key="scene.sceneName">
              {{ scene.sceneName }}
            </option>
          </select>
          <label for="lowBitrateThreshold">Low Bitrate Threshold</label>
          <input
            v-model="sceneSwitchSettings.lowBitrateThreshold"
            :disabled="srtPolling"
            id="lowBitrateThreshold"
            type="number"
          />
        </div>
      </details>
      <details>
        <summary>Bot Settings</summary>
        <div>
          <label for="botEnabled">
            <input :disabled="srtPolling" v-model="botSettings.enabled" type="checkbox" id="botEnabled" role="switch" />
            Enabled
          </label>
          <div v-if="botSettings.enabled">
            <label for="botName">Bot Name</label>
            <input
              v-model="botSettings.botName"
              :disabled="srtPolling"
              id="botName"
            />
            <label for="oauthToken">OAuth Token</label>
            <input
              v-model="botSettings.oauthToken"
              :disabled="srtPolling"
              id="oauthToken"
              type="password"
            />
            <label for="channelName">Channel Name</label>
            <input
              v-model="botSettings.channelName"
              :disabled="srtPolling"
              id="channelName"
            />
            <p>Permissions</p>
            <label for="allowModerator">
              <input :disabled="srtPolling" v-model="botSettings.permissions.moderator" type="checkbox" id="allowModerator" role="switch" />
              Moderator
            </label>
            <label for="allowPublic">
              <input :disabled="srtPolling" v-model="botSettings.permissions.public" type="checkbox" id="allowPublic" role="switch" />
              Public
            </label>
          </div>
        </div>
      </details>
      <button
        @click="startSRTPolling()"
        v-if="!srtPolling"
        type="button"
        class="btn-green"
        :disabled="!srtLiveServerSettings.statsUrl"
      >
        START
      </button>
      <button v-else @click="stopSRTPolling()" type="button" class="btn-red">
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
.btn-green {
  --background-color: var(--form-element-valid-border-color);
  --border-color: var(--form-element-valid-border-color);
}
.btn-red {
  --background-color: var(--del-color);
  --border-color: var(--del-color);
}
</style>
