import os, pathlib, subprocess, tempfile
script=pathlib.Path(__file__).resolve().with_name('update-production.sh')
def run(*args, **kw): return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,**kw)
for scenario in ['success','build-failure','health-failure','dirty','unchanged']:
 with tempfile.TemporaryDirectory() as tmp:
  root=pathlib.Path(tmp); repo=root/'repo'; prod=root/'prod'; bins=root/'bin'; bins.mkdir()
  run('git','init','-b','main',str(repo)); run('git','-C',str(repo),'config','user.email','test@example.com'); run('git','-C',str(repo),'config','user.name','Test')
  (repo/'frontend').mkdir(); (repo/'backend').mkdir(); (repo/'frontend/file').write_text('old'); (repo/'backend/file').write_text('backend'); (repo/'.gitignore').write_text('.runtime/\nfrontend/dist/\n')
  run('git','-C',str(repo),'add','.'); run('git','-C',str(repo),'commit','-m','old'); old=run('git','-C',str(repo),'rev-parse','HEAD').stdout.strip()
  run('git','-C',str(repo),'worktree','add','-b','prod',str(prod)); (prod/'.runtime').mkdir(); (prod/'.runtime/couchcontrol').write_text('old'); (prod/'frontend/dist').mkdir(); (prod/'frontend/dist/index.html').write_text('old')
  (repo/'frontend/file').write_text('new'); run('git','-C',str(repo),'commit','-am','new'); new=run('git','-C',str(repo),'rev-parse','HEAD').stdout.strip()
  commands={'npm': 'if [ "$SCENARIO" = build-failure ]; then exit 1; fi\nif [ "$1" = run ]; then mkdir -p dist; echo new > dist/index.html; fi', 'go':'if [ "$1" = build ]; then echo new > "$4"; fi', 'systemctl':'exit 0', 'curl':'[ "$SCENARIO" != health-failure ]', 'sleep':'exit 0'}
  for name,body in commands.items():
   f=bins/name; f.write_text('#!/bin/bash\nset -e\n'+body+'\n'); f.chmod(0o755)
  if scenario=='dirty': (prod/'frontend/file').write_text('dirty')
  if scenario=='unchanged': (prod/'.runtime/deployed-revision').write_text(new)
  env=dict(os.environ,PATH=str(bins)+':'+os.environ['PATH'],COUCHCONTROL_REPO=str(repo),COUCHCONTROL_PROD=str(prod),SCENARIO=scenario)
  result=subprocess.run(['bash',str(script)],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  success=scenario in ['success','unchanged']; assert (result.returncode==0)==success,result.stdout
  expected='new' if scenario=='success' else 'old'
  assert (prod/'.runtime/couchcontrol').read_text().strip()==expected,result.stdout
  assert (prod/'frontend/dist/index.html').read_text().strip()==expected,result.stdout
  assert run('git','-C',str(prod),'rev-parse','HEAD').stdout.strip()==(new if scenario=='success' else old),result.stdout
  print(scenario+': PASS')
