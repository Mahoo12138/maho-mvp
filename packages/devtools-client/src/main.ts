import App from './App.vue'
import { createClient } from './client/index.js'

const root = createClient(App as never)

// Mount immediately — the shell renders a Loading state while the loader
// waits for the first `entry:init` message. Panel plugins are loaded
// dynamically by LoaderService and register routes through `ctx.router`.
root.client.mount('#app')
