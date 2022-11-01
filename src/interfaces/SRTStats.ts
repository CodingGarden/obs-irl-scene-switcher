export default interface Stats {
  publishers: Publishers;
  status: string;
}

export interface Publishers {
  [key: string]: {
    bitrate: number;
    bytesRcvDrop: number;
    bytesRcvLoss: number;
    mbpsBandwidth: number;
    mbpsRecvRate: number;
    msRcvBuf: number;
    pktRcvDrop: number;
    pktRcvLoss: number;
    rtt: number;
    uptime: number;
  };
}
