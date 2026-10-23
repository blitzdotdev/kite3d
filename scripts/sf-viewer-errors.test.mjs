import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync('examples/sf-city/scene/viewer-entry.js','utf8');const inserted=[]
const elements=new Map(['#kite3d-canvas','#loading','#load-error','#retry'].map(k=>[k,{setAttribute(){},focus(){},insertBefore(v){inserted.push(v)}}]));const document={querySelector:k=>elements.get(k),createElement:()=>({style:{}}),body:{dataset:{}}};const context=vm.createContext({document,URL,console:{error(){}},Error})
vm.runInContext(source.slice(0,source.indexOf('// A fresh document')),context)
context.fail=new Error('Failed https://example.test/model.gltf?token=private');vm.runInContext('showFailure(fail);showFailure(new Error("cleanup"))',context)
assert.equal(inserted.length,1);assert.equal(inserted[0].textContent,'Loading the viewer: Failed https://example.test/model.gltf');assert.equal(document.body.dataset.viewerState,'error')
