import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('resolves repeated native identities to their registered Android overlay and rejects actual ambiguity', () => {
  const result = spawnSync('python', ['-c', `
import importlib.util
spec=importlib.util.spec_from_file_location('packager','scripts/android-runtime/package-runtime.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def record(name,directory,version='1.0.0'):
    return {'name':name,'version':version,'directory':directory,'dependencies':[]}
source=record('synthetic-lib','source')
native=record('synthetic-lib','android-lib')
owner=record('synthetic-addon','android-addon')
manifest={'dependencies':{'synthetic-lib':'1.0.0'}}
overlays=[(None,None,{},native),(None,None,manifest,owner)]
module.resolve_native_dependencies([source,native,owner],overlays)
assert owner['dependencies']==[{'name':'synthetic-lib','directory':'android-lib'}]
installed=record('synthetic-addon','installed-addon')
parent=record('synthetic-parent','parent')
parent['dependencies']=[{'name':'synthetic-addon','directory':'installed-addon'}]
records=[source,native,owner,installed,parent]
module.canonicalize_native_records(records,overlays)
assert set(r['directory'] for r in records)=={'android-lib','android-addon','parent'}
assert parent['dependencies']==[{'name':'synthetic-addon','directory':'android-addon'}]
for bad,extra in [(record('synthetic-lib','other','2.0.0'),[]),
                  (record('synthetic-lib','second-android'),[(None,None,{},record('synthetic-lib','second-android'))])]:
    owner['dependencies']=[]
    try:
        module.resolve_native_dependencies([source,native,owner,bad],overlays+extra)
    except ValueError as error:
        assert 'ambiguous native dependency' in str(error)
    else:
        raise AssertionError('Actual native ambiguity was accepted')
`], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
});
