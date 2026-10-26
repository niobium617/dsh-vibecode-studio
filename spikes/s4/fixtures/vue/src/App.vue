<script setup>
const bump = (name) => {
  window.__clicks = (window.__clicks ?? 0) + 1
  window.__lastClick = name
}
</script>

<template>
  <main class="app">
    <h1 id="title" @click="bump('title')">Vibe S4 · Vue</h1>
    <form id="form" @submit.prevent="bump('form')">
      <label for="name">Name</label>
      <input id="name" placeholder="Ada" @click="bump('name')" />
      <textarea id="bio" placeholder="Bio" @click="bump('bio')" />
      <select id="role" @click="bump('role')">
        <option value="dev">Developer</option>
        <option value="design">Designer</option>
      </select>
      <label class="row"><input id="agree" type="checkbox" @click="bump('agree')" /> Agree</label>
      <button id="submit" type="submit" @click="bump('submit')">Submit</button>
    </form>
    <ul id="items">
      <li id="item-1" @click="bump('item-1')">Alpha</li>
      <li id="item-2" @click="bump('item-2')">Beta</li>
      <li id="item-3" @click="bump('item-3')">Gamma</li>
    </ul>
    <p id="footer" @click="bump('footer')">Footer · vue</p>
  </main>
</template>
