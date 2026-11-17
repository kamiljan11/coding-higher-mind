#!/usr/bin/env node
'use strict';
// Test: dep-exists reads only the dependency sections of pyproject.toml. Before loop pass 10 (2026-11-15) every
// `key = value` line counted, so `[tool.ruff] line-length = 120` was looked up on PyPI and blocked the commit.
const path = require('path');
const { pyprojectDeps, pyDeps } = require(path.join(__dirname, 'dep-exists.js'));

let fails = 0;
const eq = (got, want, msg) => {
  const g = [...got].sort().join(','), w = [...want].sort().join(',');
  if (g !== w) { fails++; console.log(`FAIL: ${msg}\n  got [${g}] want [${w}]`); }
};

eq(pyprojectDeps('[tool.ruff]\nline-length = 120\nselect = ["E", "F"]\n'), [], 'tool config only = no dependencies');
eq(pyprojectDeps('[project]\nname = "demo"\nversion = "0.1"\nrequires-python = ">=3.11"\ndependencies = [\n  "requests>=2",\n  "Pydantic[email] ~= 2.0",  # comment\n]\n'),
  ['requests', 'pydantic'], '[project] multi-line dependencies, extras and comment');
eq(pyprojectDeps('[project]\ndependencies = ["httpx", "rich==13"]\n[tool.ruff]\nline-length = 100\n'), ['httpx', 'rich'], 'one-line array, then tool section ignored');
eq(pyprojectDeps('[project.optional-dependencies]\ndev = ["pytest>=8", "ruff"]\n'), ['pytest', 'ruff'], 'optional-dependencies groups');
eq(pyprojectDeps('[build-system]\nrequires = ["setuptools>=61", "wheel"]\nbuild-backend = "setuptools.build_meta"\n'), ['setuptools', 'wheel'], 'build-system requires, backend ignored');
eq(pyprojectDeps('[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = "^0.110"\n[tool.poetry.group.dev.dependencies]\nblack = "*"\n[tool.poetry]\nname = "x"\n'),
  ['fastapi', 'black'], 'poetry tables, python and [tool.poetry] name ignored');
eq(pyprojectDeps('[project]\nkeywords = ["cli", "tool"]\ndependencies = []\n'), [], 'other arrays in [project] are not dependencies');
eq(pyprojectDeps('[project]\ndependencies = ["a; python_version<\\"3.11\\"", "b @ https://x/y.whl", "c; python_version < \'3.11\'", \'d\']\n'),
  ['a', 'b', 'c', 'd'], 'environment markers with nested quotes and direct URL');
// pg-review pass10 code-1 / security-1: forms a section regex missed
eq(pyprojectDeps('[tool.poetry.dependencies]\nrequests = "*"\n[[tool.poetry.source]]\nname = "private"\nurl = "https://x"\n'), ['requests'], 'array of tables after a dependency table is not dependencies');
eq(pyprojectDeps('[project.optional-dependencies]\ndev = ["pytest"]\n[[tool.mypy.overrides]]\nmodule = ["foo.*"]\n'), ['pytest'], 'mypy overrides module list is not dependencies');
eq(pyprojectDeps('[tool.uv]\ndev-dependencies = ["u1"]\n[tool.pdm.dev-dependencies]\ntest = ["p1"]\n[tool.hatch.envs.default]\ndependencies = ["h1"]\n'), ['u1', 'p1', 'h1'], 'uv, pdm and hatch');
eq(pyprojectDeps('[project]\noptional-dependencies.dev = ["a1"]\n'), ['a1'], 'dotted optional-dependencies');
eq(pyprojectDeps('[project]\noptional-dependencies = { dev = ["b1"] }\n'), ['b1'], 'inline optional-dependencies');
eq(pyprojectDeps('project.dependencies = ["c1"]\n'), ['c1'], 'top-level dotted project.dependencies');
eq(pyprojectDeps('[tool.poetry.dependencies.d1]\nversion = "*"\n'), ['d1'], 'poetry sub-table');
eq(pyprojectDeps('[tool.poetry."dependencies"]\n"s1" = "*"\n'), ['s1'], 'quoted header and quoted key');
eq(pyprojectDeps('[project]\ndependencies = [\n "a #b", "o1"\n]\n'), ['a', 'o1'], '# inside a string is not a comment');
eq(pyprojectDeps('[project]\nrequires-python = ">=3.11"\ndependencies = []\n'), [], 'requires-python is not a dependency');
// pg-review pass10b
eq(pyprojectDeps('[tool.poetry.dependencies]\nfoo = [{version = "1", python = "<3.9"}, {version = "2"}]\nbar = {version = "1"}\n'), ['foo', 'bar'], 'poetry multiple constraints keep the name');
eq(pyprojectDeps('[tool.setuptools.dynamic]\ndependencies = {file = ["requirements.txt"]}\n'), [], 'setuptools dynamic names files, not packages');
eq(pyprojectDeps('[project]\ndependencies = ["git+https://github.com/x/y", "foo @ git+https://github.com/x/foo"]\n'), ['foo'], 'bare URL has no name; name @ URL keeps the name');
eq(pyprojectDeps('[tool.x]\nlimit = inf\nratio = 1.5\n[project]\ndependencies = ["z1"]\n'), ['z1'], 'inf/nan floats do not break parsing');
// pg-review pass10c: PEP 735 include-group inside a group
eq(pyprojectDeps('[dependency-groups]\ndev = ["pytest", {include-group = "lint"}]\nlint = ["ruff"]\n'), ['pytest', 'ruff'], 'PEP 735 include-group: specs kept, group name is not a package');
let threw = '';
try { pyprojectDeps('[project\ndependencies = ["x"]\n'); } catch (e) { threw = e.message; }
if (!/not valid TOML/.test(threw)) { fails++; console.log(`FAIL: invalid TOML must throw (got "${threw}")`); }
// requirements*.txt keeps the line parser
eq(pyDeps('requests==2.31\n# c\nnumpy>=1\n'), ['requests', 'numpy'], 'requirements.txt unchanged');

if (fails) { console.log(`test_dep_exists_pyproject: ${fails} FAIL`); process.exit(1); }
console.log('test_dep_exists_pyproject: OK');
