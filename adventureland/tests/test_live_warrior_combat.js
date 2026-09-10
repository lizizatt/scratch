"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function runCombatWith(mainhand) {
  const root = path.join(__dirname, "..");
  let src = fs.readFileSync(path.join(root, "src", "slots", "warrior.js"), "utf8");
  src = src.replace(/^load_code.*$/gm, "").replace(/^v2_start_fighter.*$/gm, "");
  const skills = [];
  const sandbox = {
    character: {
      name: "Jazwyn",
      rip: false,
      hp: 2000,
      max_hp: 2000,
      mp: 2000,
      max_mp: 2000,
      real_x: 0,
      real_y: 0,
      slots: { mainhand },
    },
    G: {
      items: {
        fireblade: { wtype: "short_sword" },
        scythe: { wtype: "scythe" },
      },
      skills: {
        cleave: { wtype: ["axe", "scythe"] },
      },
    },
    get_player() {
      return null;
    },
    get_party() {
      return { Jazwyn: {} };
    },
    get_targeted_monster() {
      return { id: "m1", type: "monster", mtype: "armadillo", real_x: 10, real_y: 0 };
    },
    get_nearest_monster() {
      return null;
    },
    get_monster() {
      return null;
    },
    change_target() {},
    set_message() {},
    is_in_range() {
      return true;
    },
    can_attack() {
      return true;
    },
    attack() {},
    use_skill(skill) {
      skills.push(skill);
    },
    is_moving() {
      return false;
    },
    parent: { entities: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  vm.runInContext("combat('armadillo', { leadName: 'Jazwyn', isLead: true })", sandbox);
  return skills;
}

test("live warrior: fireblade does not attempt axe-only cleave", () => {
  assert.deepStrictEqual(runCombatWith({ name: "fireblade", level: 1 }), []);
});

test("live warrior: scythe still uses cleave", () => {
  assert.deepStrictEqual(runCombatWith({ name: "scythe", level: 1 }), ["cleave"]);
});

module.exports = { tests };
