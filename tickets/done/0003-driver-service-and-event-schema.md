# 0003. Driver service, event schema, live view

Depends on 0002.

1. Wrap the loop parts in a small HTTP service: observe, act, start run,
   stop run, approve.
2. Publish the event schema as `packages/browser-driver` in the
   `contracts` repo. Events: step happened, decision made, approval
   needed, run finished.
3. Persistent browser profile dirs. Manual login once, session sticks.
4. Headed Chromium inside Xvfb, plus x11vnc and noVNC for live viewing
   from PC and phone.
5. ntfy notifications on approval requests and run ends.
