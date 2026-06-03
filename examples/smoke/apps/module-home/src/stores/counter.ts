import { defineStore } from 'pinia'

export const useCounterStore = defineStore('counter', {
  state: () => ({ value: 0 }),
  actions: {
    increment() {
      this.value += 1
    },
    reset() {
      this.value = 0
    },
  },
})
