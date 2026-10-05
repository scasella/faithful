// Generator of the 20 units from the clones in /tmp/faithful-libs (P = per-unit import/type prelude). Deterministic.
// Usage: node packages/translate/library-sample/build-units.cjs
const ts=require(require('path').join(__dirname,'../node_modules/typescript'));
const fs=require('fs');const path=require('path');
const OUT=__dirname;
const draw=require(OUT+'/draw.json');
const C={ 'es-toolkit':['43e1118884e07cebdf1e767038f6e7f697fa27ec','2024 Viva Republica, Inc.'],
 radash:['4cab1900d08e0997abc4f17aec3cbfe18958d766','2022 radash'], remeda:['8e6e78f6eaf66eaf0b4797d72cc3691823c91335','2018 remeda']};
const R='/tmp/faithful-libs/';
function src(lib,p){const f=R+lib+'/'+p;const t=fs.readFileSync(f,'utf8');return {t,sf:ts.createSourceFile(f,t,ts.ScriptTarget.Latest,true)};}
// verbatim span of named top-level declarations (all statements declaring the name), with leading comments
function span(lib,p,name){const {t,sf}=src(lib,p);
 const sts=sf.statements.filter(s=>(s.name&&s.name.text===name)||(ts.isVariableStatement(s)&&s.declarationList.declarations.some(x=>x.name.text===name)));
 if(!sts.length) throw new Error('missing '+lib+p+name);
 return t.slice(sts[0].getFullStart(),sts[sts.length-1].getEnd()).replace(/^\s*\n/,'');}
function imp(lib,p,from){const {sf}=src(lib,p);const s=sf.statements.find(s=>ts.isImportDeclaration(s)&&s.moduleSpecifier.text===from);if(!s)throw new Error('imp '+from);return s.getText(sf);}
// prelude per unit: list of ['imp', from] (import kept verbatim from the function's own file) or ['decl', path, name] (verbatim declaration)
const P={
 'es-toolkit/difference':[['imp','../../array/difference.ts'],['imp','../_internal/lazy.ts']],
 'es-toolkit/unzipWith':[['imp','../../array/unzip.ts'],['imp','../predicate/isArray.ts'],['imp','../predicate/isArrayLikeObject.ts']],
 'es-toolkit/stubA':[],
 'es-toolkit/words':[],
 'es-toolkit/clamp':[],
 'es-toolkit/overArgs':[['imp','../../function/identity.ts'],['imp','../util/iteratee.ts'],['decl','src/compat/_internal/Many.ts','Many']],
 'es-toolkit/pullAll':[['imp','../../array/pull.ts'],['decl','src/compat/_internal/Equals.d.ts','Equals'],['decl','src/compat/_internal/MutableList.d.ts','MutableList'],['decl','src/compat/_internal/IsWritable.d.ts','IsWritable'],['decl','src/compat/_internal/RejectReadonly.d.ts','RejectReadonly']],
 'radash/range':[['imp','./typed']],
 'radash/alphabetical':[],
 'radash/trim':[],
 'radash/tryit':[['imp','./typed']],
 'radash/objectify':[],
 'radash/lowerize':[['decl','src/object.ts','LowercasedKeys']],
 'radash/intersects':[],
 'remeda/forEachObj':[['imp','./internal/types/EnumerableStringKeyedValueOf'],['imp','./purry'],['decl','packages/remeda/src/internal/types/ToString.ts','ToString'],['decl','packages/remeda/src/internal/types/EnumerableStringKeyOf.ts','EnumerableStringKeyOf']],
 'remeda/binarySearchCutoffIndex':[],
 'remeda/firstBy':[['imp','./internal/purryOrderRules'],['decl','packages/remeda/src/internal/types/IterableContainer.ts','IterableContainer'],['decl','packages/remeda/src/internal/types/NonEmptyArray.ts','NonEmptyArray'],['decl','packages/remeda/src/firstBy.ts','FirstBy']],
 'remeda/floor':[['imp','./internal/withPrecision'],['imp','./purry']],
 'remeda/hasSubObject':[['imp','type-fest'],['imp','./isDeepEqual'],['imp','./purry'],['decl','packages/remeda/src/hasSubObject.ts','BRAND_HAS_SUB_OBJECT'],['decl','packages/remeda/src/hasSubObject.ts','HasSubObjectGuard'],['decl','packages/remeda/src/hasSubObject.ts','HasSubObjectObjectValue'],['decl','packages/remeda/src/hasSubObject.ts','HasSubObjectData'],['decl','packages/remeda/src/hasSubObject.ts','HasSubObjectSubObject']],
 'remeda/heapMaybeInsert':[['imp','../hasAtLeast'],['decl','packages/remeda/src/internal/types/CompareFunction.ts','CompareFunction']],
};
for(const L of draw.libraries)for(const d of L.drawn){
 const key=L.lib+'/'+d.name;const pre=P[key];if(!pre)throw new Error('no prelude '+key);
 const [sha,holder]=C[L.lib];
 const parts=[`// @sample library=${L.lib} path=${d.path} commit=${sha} license=MIT`,`// Copyright (c) ${holder}; MIT License; see LICENSES/${L.lib}.txt`,''];
 const imps=pre.filter(x=>x[0]==='imp').map(x=>imp(L.lib,d.path,x[1]));
 if(imps.length)parts.push(imps.join('\n'),'');
 for(const x of pre.filter(x=>x[0]==='decl'))parts.push(span(L.lib,x[1],x[2]),'');
 parts.push(span(L.lib,d.path,d.name),'');
 fs.mkdirSync(OUT+'/'+L.lib,{recursive:true});
 fs.writeFileSync(`${OUT}/${L.lib}/${d.name}.ts`,parts.join('\n'));
}
