class Target extends EventTarget {
  emit(type, properties = {}) {
    this.dispatchEvent(Object.assign(new Event(type), properties));
  }
}
export function createPeerHub() {
  const servers = new Map();
  const stats = { sends: 0 };
  class Connection extends Target {
    connected = false;
    closed = false;
    channels = new Map();
    peerconnection = {
      createDataChannel: (_, options) => {
        const channel = {
          readyState: "open",
          bufferedAmount: 0,
          close() {
            this.readyState = "closed";
          },
          send: (data) => {
            stats.sends++;
            queueMicrotask(() => {
              if (!this.closed)
                this.other.channels.get(options.id)?.onmessage?.({ data });
            });
          },
        };
        this.channels.set(options.id, channel);
        return channel;
      },
    };
    send(data) {
      stats.sends++;
      queueMicrotask(() => {
        if (!this.closed) this.other.emit("message", { data });
      });
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.connected = false;
      this.emit("close");
      this.other.close();
    }
  }
  return {
    stats,
    peer: {
      async serve() {
        const server = new Target();
        server.inviteCode = crypto.randomUUID();
        server.close = () => {
          servers.delete(server.inviteCode);
          server.emit("close");
        };
        servers.set(server.inviteCode, server);
        return server;
      },
      async connect(code) {
        const server = servers.get(code);
        if (!server) throw Error("no_host");
        const a = new Connection(),
          b = new Connection();
        a.other = b;
        b.other = a;
        // Each end of a connection has its own transport certificate.
        const [fa, fb] = [crypto.randomUUID(), crypto.randomUUID()].map(
          (id) => ({ sdp: `v=0\r\na=fingerprint:sha-256 ${id}\r\n` }),
        );
        Object.assign(a.peerconnection, {
          localDescription: fa,
          remoteDescription: fb,
        });
        Object.assign(b.peerconnection, {
          localDescription: fb,
          remoteDescription: fa,
        });
        setTimeout(() => {
          server.emit("connection", { conn: b });
          a.connected = b.connected = true;
          a.emit("open");
          b.emit("open");
        }, 0);
        return a;
      },
    },
  };
}
