<script setup lang="ts">
import {
  onMounted, reactive, ref,
} from 'vue';
import OBSWebSocket from 'obs-websocket-js';
import * as tmi from 'tmi.js';

import type OBSScene from '@/interfaces/OBSScene';
import reactiveFromLocalStorage from '@/lib/reactiveLocalStorage';
import SRTStatsMonitor from '@/lib/SRTStatsMonitor';

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
    packetLossSceneName: '',
    beRightBackSceneName: '',
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

const statsMonitor = new SRTStatsMonitor();

let sceneMessageTimeout = -1;
function switchSceneAndNotify({
  sceneName,
  message,
}: {
  sceneName: string;
  message: string;
}) {
  obsState.currentSceneName = sceneName;
  obs.call('SetCurrentProgramScene', {
    sceneName,
  });
  if (botSettings.enabled) {
    clearTimeout(sceneMessageTimeout);
    sceneMessageTimeout = setTimeout(() => {
      client.say(botSettings.channelName, message);
    }, 1500);
  }
}

async function getSRTStats() {
  if (!srtPolling.value) return;
  await statsMonitor.getNextStats();
  const onValidScene = [
    sceneSwitchSettings.mainSceneName,
    sceneSwitchSettings.packetLossSceneName,
    sceneSwitchSettings.beRightBackSceneName,
  ].includes(obsState.currentSceneName);
  const connected = !!statsMonitor.currentPublisher.value;
  const connectedAndShouldSwitch = connected && onValidScene;
  if (
    connectedAndShouldSwitch
    && statsMonitor.avgPktRcvDrops.value <= 5
    && obsState.currentSceneName !== sceneSwitchSettings.mainSceneName
  ) {
    switchSceneAndNotify({
      sceneName: sceneSwitchSettings.mainSceneName,
      message: '✅ Good Connection!',
    });
  } else if (
    connectedAndShouldSwitch
    && statsMonitor.avgPktRcvDrops.value > 5
    && obsState.currentSceneName !== sceneSwitchSettings.packetLossSceneName
  ) {
    switchSceneAndNotify({
      sceneName: sceneSwitchSettings.packetLossSceneName,
      message: '⚠️ Packet Loss Detected...',
    });
  } else if (
    !connected
    && onValidScene
    && obsState.currentSceneName !== sceneSwitchSettings.beRightBackSceneName
  ) {
    switchSceneAndNotify({
      sceneName: sceneSwitchSettings.beRightBackSceneName,
      message: '⛔️ Disconnected...',
    });
  }
  if (srtPolling.value) {
    setTimeout(getSRTStats, 1000);
  }
}

function sendStats() {
  if (!srtPolling.value) return;

  if (obsState.currentSceneName === sceneSwitchSettings.packetLossSceneName) {
    client.say(botSettings.channelName, `📉 Packet Loss: ${statsMonitor.avgPktRcvDrops.value}/s`);
  }

  setTimeout(sendStats, 5000);
}

function startSRTPolling() {
  srtPolling.value = true;
  statsMonitor.settings = srtLiveServerSettings;
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
        if (statsMonitor.currentPublisher.value) {
          client.say(botSettings.channelName, `Current bitrate: ${statsMonitor.currentPublisher.value.bitrate} Kb/s`);
        } else {
          client.say(botSettings.channelName, 'Bitrate not available...');
        }
      } else if (message === '!scene' || message === '!currentscene') {
        client.say(botSettings.channelName, `Current scene: ${obsState.currentSceneName}`);
      } else if (message === '!stats') {
        if (statsMonitor.currentPublisher.value) {
          client.say(botSettings.channelName, `📉 Packet Loss: ${statsMonitor.avgPktRcvDrops}/s`);
        } else {
          client.say(botSettings.channelName, 'Stats not available...');
        }
      }
    });
    client.connect();
  }
  getSRTStats();
  setTimeout(sendStats, 10000);
}

function stopSRTPolling() {
  srtPolling.value = false;
  statsMonitor.clear();
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
          <hr />
          <label for="packetLossSceneName">Packet Loss Scene</label>
          <select
            v-model="sceneSwitchSettings.packetLossSceneName"
            :disabled="srtPolling"
            id="packetLossSceneName"
          >
            <option v-for="scene in obsState.scenes" :key="scene.sceneName">
              {{ scene.sceneName }}
            </option>
          </select>
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
