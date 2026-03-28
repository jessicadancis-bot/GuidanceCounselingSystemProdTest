const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const AppError = require("./utils/AppError");
const pool = require("./db");
const { normalize } = require("./utils/DataHelper");
const { ROLE, STATUS } = require("./config/serverConstants");
const { generateRandomID } = require("./utils/randomizer");

const virtual_room_map = new Map();
const clients = new Map();
const conversations_map = new Map();
const cases_map = new Map();
const v_room_pending_join_req = new Map();

const createWebSocket = ({ server }) => {
  const {
    getMyConversations,
    insertToConversation,
    findOrCreateConversation,
  } = require("./services/messagingServices");
  const { getCases } = require("./services/counselingServices");

  const wss = new WebSocket.Server({ server });

  const HEARTBEAT_TIMEOUT = 90000;

  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const now = Date.now();

      if (now - (ws.last_ping || 0) > HEARTBEAT_TIMEOUT) {
        ws.terminate();
      }
    });
  }, 30000);

  setInterval(() => {
    const now = Date.now();

    for (const [room_id, participants] of virtual_room_map.entries()) {
      if (!participants || participants.length === 0) {
        virtual_room_map.delete(room_id);
        continue;
      }

      const room_last_active = participants.room_last_active || now;
      if (now - room_last_active > 10 * 60 * 1000) {
        virtual_room_map.delete(room_id);
      }
    }
  }, 60000);

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (!token) throw new AppError("Authentication token must be provided");

    let decoded;
    try {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (e) {
        throw new AppError("Unauthorized Access.", 401);
      }

      ws.account_id = decoded?.accountId;
      ws.role = decoded?.role;

      const [user_rows] = await pool.query(
        `
        SELECT public_id, given_name, last_name, middle_name
        FROM users 
        WHERE account_id = ?`,
        [ws.account_id],
      );

      const user = user_rows[0];

      if (!user) throw new AppError("User not found.", 404);

      ws.public_id = user.public_id;
      ws.given_name = user.given_name;
      ws.middle_name = user.middle_name || "";
      ws.last_name = user.last_name;
      ws.is_alive = true;
      ws.last_ping = Date.now();

      if (!clients.has(ws.account_id)) {
        clients.set(ws.account_id, new Set());
      }

      clients.get(ws.account_id).add(ws);

      await pool.query(
        `
        UPDATE users SET status = ?
        WHERE public_id = ?
      `,
        ["online", ws.public_id],
      );

      const conversations =
        (await getMyConversations({
          account_id: ws.account_id,
        })) || [];

      const cases =
        (await getCases({
          client_id: ws.role === ROLE.CLIENT ? ws.account_id : undefined,
          counselor_id: ws.role === ROLE.COUNSELOR ? ws.account_id : undefined,
          status: `${STATUS.ONGOING}`,
        })) || [];

      ws.conversations = new Set(conversations.data?.map((c) => c.id) || []);
      ws.cases = new Set(cases.data?.map((c) => c.case_id) || []);

      for (const c of ws.conversations || []) {
        if (conversations_map.has(c)) {
          for (const prt of conversations_map.get(c)) {
            if (prt.readyState === WebSocket.OPEN) {
              prt.send(
                JSON.stringify({
                  type: "user_connected",
                  status: "online",
                  user_id: ws.public_id,
                  conversation_id: c,
                }),
              );
            }
          }

          conversations_map.get(c).add(ws);
          continue;
        }
        conversations_map.set(`${c}`, new Set([ws]));
      }

      for (const c of ws.cases || []) {
        if (cases_map.has(c)) {
          cases_map.get(c).add(ws);
          continue;
        }

        cases_map.set(`${c}`, new Set([ws]));
      }
    } catch (e) {
      console.error(e);
      const message = e.isOperational ? e.message : "Internal Server Error";
      ws.close(4001, ws.close(4001, message));
      return;
    }

    ws.on("message", async (message) => {
      const data = JSON.parse(message.toString());
      try {
        switch (data.type) {
          case "presence_ping": {
            ws.is_alive = true;
            ws.last_ping = Date.now();
            break;
          }

          case "chat": {
            let conversation_id = normalize(data.conversation_id);
            const message_id = normalize(data.message_id);
            const recipient_id = normalize(data.recipient_id);
            const message = normalize(data.content);

            if (!message) return;

            if (recipient_id) {
              const tmp_cnv_id = conversation_id;

              const conversation = await findOrCreateConversation({
                sender: ws.account_id,
                recipient_public_id: recipient_id,
              });

              const created_convo_id = conversation.data.conversation_id;

              ws.send(
                JSON.stringify({
                  type: "convo_created",
                  conversation_id: created_convo_id,
                  tmp_cnv_id,
                }),
              );

              const sender = clients.get(ws.account_id) || [];
              const recipient =
                clients.get(conversation.data.recipient_id) || [];

              const convo_listeners = new Set();

              for (const conn of sender) {
                conn.conversations?.add(created_convo_id);
                convo_listeners.add(conn);
              }

              if (recipient) {
                for (const conn of recipient) {
                  conn.conversations?.add(created_convo_id);
                  convo_listeners.add(conn);
                }
              }

              if (!conversations_map.has(created_convo_id)) {
                conversations_map.set(created_convo_id, convo_listeners);
              } else {
                const existing = conversations_map.get(created_convo_id);
                for (const s of convo_listeners) existing.add(s);
              }

              conversation_id = created_convo_id;
            }

            await insertToConversation({
              conversation_id,
              sender_id: ws.account_id,
              content: message,
            });

            for (const c of conversations_map.get(conversation_id) || []) {
              if (c.account_id === ws.account_id) continue;
              if (c.readyState === WebSocket.OPEN) {
                c.send(
                  JSON.stringify({
                    type: "chat",
                    conversation_id,
                    sender_id: ws.public_id,
                    sender_name: `${ws.given_name} ${ws.last_name}`,
                    content: message,
                  }),
                );
              }
            }

            ws.send(
              JSON.stringify({
                type: "message_sent",
                message_id,
                conversation_id,
                message,
              }),
            );

            break;
          }

          case "create_room": {
            if (ws.role === ROLE.CLIENT) break;

            const room_id = generateRandomID({});
            const room_participant = [{ connection: ws, role: "master" }];
            virtual_room_map.set(room_id, room_participant);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "room_created", room_id }));
            }

            break;
          }

          case "join_virtual_room": {
            const room_id = normalize(data.room_id);
            const virtual_room = virtual_room_map.get(room_id);
            if (!virtual_room) break;

            for (const participant of virtual_room) {
              if (participant.role !== "master") continue;

              const request_id = generateRandomID({});
              v_room_pending_join_req.set(request_id, {
                connection: ws,
                room_id,
                room_master: participant.connection?.account_id,
              });

              const p_conn = participant.connection;
              if (p_conn.readyState === WebSocket.OPEN) {
                p_conn.send(
                  JSON.stringify({
                    type: "join_request",
                    request_id,
                    requestor_name: `${ws.given_name} ${ws?.middle_name} ${ws.last_name}`,
                  }),
                );
              }
            }
            break;
          }

          case "join_accepted": {
            const target_request = normalize(data.target_request);
            const request = v_room_pending_join_req.get(target_request);
            if (!request) break;

            if (ws.account_id !== request.room_master) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Only the room master can accept join requests.",
                }),
              );
              break;
            }

            const requester_conn = request.connection;

            if (requester_conn.readyState === WebSocket.OPEN) {
              requester_conn.send(
                JSON.stringify({
                  type: "join_accepted",
                  room_id: request.room_id,
                }),
              );
            }

            const virtual_room = virtual_room_map.get(request.room_id);
            if (virtual_room) {
              virtual_room.push({
                connection: requester_conn,
                role: "participant",
              });
            }

            if (!requester_conn.room_joined)
              requester_conn.room_joined = new Set();
            requester_conn.room_joined.add(request.room_id);

            for (const participant of virtual_room) {
              const p_conn = participant.connection;
              if (p_conn.account_id === requester_conn.account_id) continue;

              if (p_conn.readyState === WebSocket.OPEN) {
                p_conn.send(
                  JSON.stringify({
                    type: "user_joined",
                    new_user_name: `${requester_conn.given_name} ${requester_conn?.middle_name ?? ""} ${requester_conn.last_name}`,
                    public_id: requester_conn.public_id,
                  }),
                );
              }
            }

            v_room_pending_join_req.delete(target_request);
            break;
          }

          case "call_offer": {
            const { sdp } = data;
            const room_id = normalize(data.room_id);
            const target_public_id = normalize(data.target_public_id);

            const virtual_room = virtual_room_map.get(room_id);
            if (!virtual_room) break;

            const sender_in_room = virtual_room.find(
              (participant) => participant.connection === ws,
            );
            if (!sender_in_room) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "You are not a participant of this room",
                }),
              );
              break;
            }

            const receiver = virtual_room.find(
              (participant) =>
                participant.connection.public_id === target_public_id,
            );

            const r_conn = receiver?.connection;
            if (receiver) {
              r_conn.send(
                JSON.stringify({
                  type: "call_offer",
                  sdp,
                  new_user_name: `${ws.given_name} ${ws?.middle_name} ${ws.last_name}`,
                  sender: ws.public_id,
                }),
              );
            }

            break;
          }

          case "stop_screen_share": {
            const room_id = normalize(data.room_id);
            const track_video_id = normalize(data.track_video_id);

            const virtual_room = virtual_room_map.get(room_id);
            if (!virtual_room) break;

            const sender_in_room = virtual_room.find(
              (participant) => participant.connection === ws,
            );
            if (!sender_in_room) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "You are not a participant of this room",
                }),
              );
              break;
            }

            for (const participant of virtual_room) {
              const p_conn = participant.connection;
              if (p_conn.account_id === ws.account_id) continue;

              if (p_conn.readyState === WebSocket.OPEN) {
                p_conn.send(
                  JSON.stringify({
                    type: "stop_screen_share",
                    sender: ws.public_id,
                    track_video_id: track_video_id,
                  }),
                );
              }
            }

            break;
          }

          case "call_answer": {
            const { sdp } = data;
            const room_id = normalize(data.room_id);
            const target_public_id = normalize(data.target_public_id);

            const virtual_room = virtual_room_map.get(room_id);
            if (!virtual_room) break;

            const sender_in_room = virtual_room.find(
              (p) => p.connection === ws,
            );
            if (!sender_in_room) break;

            const target_participant = virtual_room.find(
              (p) => p.connection.public_id === target_public_id,
            );
            if (
              !target_participant ||
              target_participant.connection.readyState !== WebSocket.OPEN
            )
              break;

            target_participant.connection.send(
              JSON.stringify({
                type: "call_answer",
                sdp,
                sender: ws.public_id,
              }),
            );

            break;
          }

          case "user_disconnect": {
            const room_id = normalize(data.room_id);
            const virtual_room = virtual_room_map.get(room_id);
            if (!virtual_room) break;

            const updated_room = virtual_room.filter(
              (p) => p.connection !== ws,
            );
            virtual_room_map.set(room_id, updated_room);

            for (const participant of updated_room) {
              const p_conn = participant.connection;
              if (p_conn.account_id === ws.account_id) continue;

              if (p_conn.readyState === WebSocket.OPEN) {
                p_conn.send(
                  JSON.stringify({
                    type: "user_disconnect",
                    sender: ws.public_id,
                  }),
                );
              }
            }

            ws.room_joined = new Set();

            break;
          }

          case "ice_candidate": {
            const { candidate } = data;
            const room_id = normalize(data.room_id);
            const target_public_id = normalize(data.target_public_id);

            const virtual_room = virtual_room_map.get(room_id);
            if (!virtual_room) break;

            const sender_in_room = virtual_room.find(
              (p) => p.connection === ws,
            );
            if (!sender_in_room) break;

            const receiver = virtual_room.find(
              (r) => r.connection.public_id === target_public_id,
            );
            const r_conn = receiver?.connection;
            if (r_conn) {
              r_conn.send(
                JSON.stringify({
                  type: "ice_candidate",
                  candidate,
                  sender: ws.public_id,
                }),
              );
            }

            break;
          }
        }
      } catch (e) {
        console.error(e);
        ws.send(
          JSON.stringify({
            type: "error",
            message: e.message,
            errors: e.errors,
          }),
        );
      }
    });

    ws.on("close", async () => {
      try {
        const c_conn = clients.get(ws.account_id);

        if (ws.conversations?.size > 0) {
          for (const c of ws.conversations || []) {
            const convo = conversations_map.get(c);
            if (!convo) continue;

            for (const prt of convo) {
              if (prt.account_id === ws.account_id) continue;
              if (prt.readyState === WebSocket.OPEN) {
                prt.send(
                  JSON.stringify({
                    type: "user_connected",
                    status: "offline",
                    user_id: ws.public_id,
                    conversation_id: c,
                  }),
                );
              }
            }

            convo.delete(ws);

            if (convo.size === 0) {
              conversations_map.delete(c);
            }
          }
        }

        if (ws.cases?.size > 0) {
          for (const case_id of ws.cases || []) {
            const curr_case = cases_map.get(case_id);
            if (!curr_case) continue;

            curr_case.delete(ws);

            if (curr_case.size === 0) {
              cases_map.delete(case_id);
            }
          }
        }

        if (ws.room_joined?.size > 0) {
          for (const room_id of ws.room_joined || []) {
            const v_room = virtual_room_map.get(room_id);
            if (!v_room) continue;

            const updated_room = v_room.filter((p) => p.connection !== ws);
            virtual_room_map.set(room_id, updated_room);

            for (const participant of updated_room) {
              const p_conn = participant.connection;
              if (p_conn.account_id === ws.account_id) continue;

              if (p_conn.readyState === WebSocket.OPEN) {
                p_conn.send(
                  JSON.stringify({
                    type: "user_disconnect",
                    sender: ws.public_id,
                  }),
                );
              }
            }
          }
        }

        if (c_conn) {
          c_conn.delete(ws);
          if (c_conn.size === 0) {
            await pool.query(
            `
              UPDATE users SET status = ?
              WHERE public_id = ?
            `, ["offline", ws.public_id]
            );

            clients.delete(ws.account_id);
          }
        }
      } catch (e) {
        console.error(e);
        ws.send(
          JSON.stringify({
            type: "error",
            message: e.message,
            errors: e.errors,
          }),
        );
      }
    });
  });
};

const sendNotificationPing = ({ client_id }) => {
  const validations = [
    {
      check: !client_id,
      message: "The Audience id must be provided to send the notification.",
    },
  ];

  const validation_errors = validations
    .filter((v) => v.check)
    .map((v) => v.message);
  if (validation_errors.length > 0) {
    throw new AppError("Validation errors", 400, validation_errors);
  }

  const client = clients.get(client_id);

  if (!client) return;

  for (const conn of client) {
    if (conn.readyState === WebSocket.OPEN) {
      conn.send(
        JSON.stringify({
          type: "notification",
        }),
      );
    }
  }
};

const addConversationToMap = ({ room_id }) => {
  if (!conversations_map.has(room_id)) {
    conversations_map.set(room_id, new Set());
  }
};

const addConversationListener = ({ room_id, participant_ids }) => {
  const conversation = conversations_map.get(room_id);
  if (!conversation) return;
  for (const account_id of participant_ids) {
    const sockets = clients.get(account_id);
    if (!sockets) continue;
    for (const s of sockets) {
      if (s.readyState === WebSocket.OPEN) {
        conversation.add(s);
      }
    }
  }
};

const requestCreated = () => {
  for (const [client, cons] of clients) {
    for (const conn of cons) {
      if (conn.role !== ROLE.COUNSELOR) continue;
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(
          JSON.stringify({
            type: "new_request",
          }),
        );
      }
    }
  }
};

const notifyCaseUpdate = ({ case_id, sender }) => {
  const case_d = cases_map.get(case_id);

  if (!case_d) return;

  for (const conn of case_d) {
    if (conn.account_id === sender) continue;
    if (conn.readyState === WebSocket.OPEN) {
      conn.send(
        JSON.stringify({
          type: "case_update",
        }),
      );
    }
  }
};

module.exports = {
  addConversationToMap,
  addConversationListener,
  createWebSocket,
  sendNotificationPing,
  requestCreated,
  notifyCaseUpdate,
};
