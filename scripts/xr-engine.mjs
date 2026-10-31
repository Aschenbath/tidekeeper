/** Same assertions and saved inputs for CLI and the MCP execution adapter. */
export async function runAcceptance(call, scenarios, emit = () => {}) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  let debugIndex, entryBoard, baseline, previewFrames;
  const state = async () => {
    if (debugIndex === undefined) {
      const found = await call('ecs', 'find', {withComponents:['GameDebug']});
      assert(found.entities?.length === 1, 'Expected one dev-only GameDebug entity'); debugIndex = found.entities[0].entityIndex;
    }
    const q = await call('ecs','query',{entityIndex:debugIndex});
    return JSON.parse(q.components.find(c => c.componentId === 'GameDebug').values.state);
  };
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const press = async (target, device = 'hand-right') => {
    const resolved = /^(Tray_|Cell_|Piece_)/.test(target) ? {name:target,face:'top'} : target;
    const result = await call('xr','run-sequence',{device,body:'auto',gaze:'fixed',idleHand:'keep',steps:[{target:resolved,press:{hold:0.07}}]});
    assert(result.completed && !result.cancelled, `Incomplete press ${target}`);
    assert(result.presses?.length, `No fingertip contact ${target}`);
    await call('browser','interact',{steps:[{action:'wait',durationMs:120}]});
  };
  const lines = [];
  for (const scenario of scenarios) {
    let actionNumber = 0;
    try {
      for (const action of scenario.actions) {
        actionNumber++;
        if (action.call) {
          if (action.call[0] === 'browser' && action.call[1] === 'reload') debugIndex = undefined;
          await call(...action.call);
        }
        if (action.setup) {
          await state();
          await call('ecs','set-component',{entityIndex:debugIndex,componentId:'GameDebug',field:'command',value:JSON.stringify(action.setup)});
          await call('browser','interact',{steps:[{action:'wait',durationMs:200}]});
        }
        if (action.sequence) {
          const r = await call('xr','run-sequence',action.sequence);
          assert(r.completed && !r.cancelled, 'Incomplete hand sequence');
        }
        if (action.press) await press(action.press);
        // Several presses in one hand sequence, for timing-sensitive steps (a CLI round trip outlasts mission 1's run).
        if (action.presses) {
          const steps = action.presses.map(t => ({target:/^(Tray_|Cell_|Piece_)/.test(t) ? {name:t,face:'top'} : t, press:{hold:0.07}}));
          const r = await call('xr','run-sequence',{device:'hand-right',body:'auto',gaze:'fixed',idleHand:'keep',steps});
          assert(r.completed && !r.cancelled && r.presses?.length === steps.length, `Incomplete presses ${action.presses.join(',')}`);
        }
        // The CLI caps one wait step at 12 s, so long waits are split.
        if (action.wait) for (let left = Math.round(action.wait * 1000); left > 0; left -= 12000)
          await call('browser','interact',{steps:[{action:'wait',durationMs:Math.min(left, 12000)}]});
        if (action.screenshot) await call('browser','screenshot',undefined,['--output-file',`output/xr/${action.screenshot}`]);
        if (action.place) {
          const [piece,x,y,rot] = action.place;
          await press(`Tray_${piece}`); await press(`Cell_${x}_${y}`);
          let s = await state(), p = s.placements.find(p=>p.x===x && p.y===y);
          assert(p?.piece === piece, `Failed to place ${piece} at ${x},${y}`);
          for (let i=0; p.rot!==rot && i<4; i++) {
            assert(piece!=='lock','Use the contextual Turn lock control for lock rotation');
            await press(`Piece_${x}_${y}`); s=await state(); p=s.placements.find(p=>p.x===x && p.y===y);
          }
          assert(p.rot===rot, `Rotation mismatch at ${x},${y}`);
        }
        if (action.reachGrid) {
          const s = await state(), steps = [], tilt = s.board.rotation[0];
          assert(s.mission === 'm09' && s.board.reach === 'far', 'Expected the finale at far reach');
          // Move the actual index fingertip over all 42 cell centres, including fixed and rock cells.
          // Keep 6 cm above the board: pieces stand up to 2 cm tall and the fingertip touch range would edit them at 3 cm.
          for (let y=0; y<6; y++) for (let x=0; x<7; x++) {
            const px=(x-3)*0.055, pz=(y-2.5)*0.055;
            const position={x:s.board.position[0]+px,y:s.board.position[1]+0.06*Math.cos(tilt)-pz*Math.sin(tilt),z:s.board.position[2]+0.06*Math.sin(tilt)+pz*Math.cos(tilt)};
            steps.push({position,anchor:'index-tip',poseId:'point',duration:0.06});
          }
          for (let i=0;i<steps.length;i+=7) {
            const r=await call('xr','run-sequence',{device:'hand-right',gaze:'fixed',body:'auto',idleHand:'keep',steps:steps.slice(i,i+7)});
            assert(r.completed && !r.cancelled,'Could not reach every finale cell');
          }
          const after=await state(); assert(same(s.placements,after.placements),'Reach probe edited the board');
        }
        if (action.check) {
          let s = await state();
          // Headless frames are slow and uneven, so a run can outlast its scripted wait; finish it before judging.
          for (let i = 0; i < 20 && s.phase === 'running' && /^(success|dailyRecorded|firstDelivery)/.test(action.check); i++) {
            await call('browser','interact',{steps:[{action:'wait',durationMs:1000}]}); s = await state();
          }
          switch (action.check) {
            case 'entry': {
              const xr = await call('xr','status'); assert(xr.sessionActive,'XR inactive');
              assert(Math.abs(s.board.position[1]-1.25)<0.015 && Math.abs(s.board.position[2]+0.45)<0.015,'Incorrect initial board placement');
              assert(Math.abs(s.board.rotation[0]-Math.PI/12)<0.001,'Board not tilted 15 degrees'); entryBoard=s.board; break;
            }
            case 'worldLocked': assert(same(s.board,entryBoard),'Head movement moved the board'); break;
            case 'carriedRight': case 'carriedLeft':
              assert(s.carried.length===1 && s.carried[0].hand===(action.check==='carriedRight'?'right':'left'),'Wrong carry hand/count'); assert(!s.placements.length,'Placement during carry'); break;
            case 'm01Placed': assert(same(s.placements,[{x:2,y:1,piece:'bend',rot:2}]),'One auto-rotated bend expected'); assert(!s.carried.length && s.remaining.bend===0,'Carry/budget mismatch'); baseline=s.placements; break;
            case 'emptyNoCarry': assert(s.phase==='editing' && !s.placements.length && !s.carried.length && s.remaining.bend===1,'Near miss did not return to editing/tray'); break;
            case 'selectedBend': assert(s.selected==='bend' && !s.placements.length,'Poke did not select'); break;
            case 'rotated': assert(s.placements[0]?.rot===3,'Poke did not rotate once'); break;
            case 'preview': case 'dialPreview':
              assert(same(s.placements,baseline),'Scrubbing changed placements');
              assert(same(s.frame,s.frames[Math.min(s.tick,s.frames.length-1)]),'Preview frame mismatch');
              for (const b of s.frame.boats) {
                const visible=s.renderedBoats.find(v=>v.name===`Boat_${b.id}`);
                assert(Math.abs(visible.position[0]-(b.x-2)*0.055)<1e-6 && Math.abs(visible.position[2]-(b.y-1.5)*0.055)<1e-6,'Rendered ghost does not match simulation');
              }
              if (action.check==='preview') assert(s.tick===2,'Poke dial did not step to tick 2');
              else assert(s.tick!==2,'Pinch dial did not scrub'); previewFrames=s.frames; break;
            case 'paused': assert(s.phase==='paused','Pause failed'); baseline=s.placements; break;
            case 'stopped': assert(s.phase==='editing' && s.tick===0 && same(s.placements,baseline),'Stop changed board'); break;
            case 'successM01': assert(s.mission==='m01' && s.phase==='success' && s.stars===3,'Mission 1 not mastered'); assert(same(s.frames,previewFrames),'Launch did not use preview frames'); break;
            case 'successM02': case 'successM03': case 'successM04':
              assert(s.mission===`m0${action.check.slice(-1)}` && s.phase==='success' && s.stars===3,`${s.mission} not mastered`); assert(s.hintsUsed===0,'Mission used hints'); break;
            case 'successM05': case 'successM06': case 'successM07': case 'successM08': case 'successM09':
              assert(s.mission===`m0${action.check.slice(-1)}` && s.phase==='success',`${s.mission} did not complete`);
              assert(s.progress.missions[s.mission]?.stars > 0,'Campaign result was not saved');
              if (action.check==='successM09') {
                assert(s.lighthouse,'Finale did not light the lighthouse');
                emit(`METRIC m09 renderer.info ${JSON.stringify(s.renderer)}`);
                assert(s.renderer.calls<=100,`Draw-call budget exceeded: ${s.renderer.calls}`);
              }
              break;
            case 'crossingPreview': assert(s.phase==='editing' && s.outcome.failures[0]?.kind==='collision' && s.renderedGhosts.length===2 && s.status.includes('boats'),'Crossing preview lacks collision ghosts/reason'); break;
            case 'mapLit': assert(s.view==='map' && Object.keys(s.progress.missions).length>=5,'Map did not show saved villages'); break;
            case 'lockedMap': assert(s.view==='map' && !s.progress.missions.m08,'Locked mission became playable'); break;
            case 'dailyLoaded': assert(s.dailyDate===s.daily.date && s.mission===`daily-${s.daily.date}`,'Wrong daily loaded'); break;
            case 'dailyRecorded': assert(s.phase==='success' && s.daily.best?.pieces===s.placements.length && s.daily.streak>=1,'Daily result/streak missing'); break;
            case 'soundOff': assert(!s.progress.settings.sound,'Sound setting did not change'); break;
            case 'persisted': assert(s.view==='map' && s.progress.missions.m09 && s.daily.best && !s.progress.settings.sound && s.progress.settings.reach==='far','Progress/settings did not survive reload'); break;
            case 'resetCancelled': assert(s.progress.missions.m09 && s.daily.best,'Cancel erased progress'); break;
            case 'reset': assert(s.mission==='m01' && !Object.keys(s.progress.missions).length && !Object.keys(s.progress.daily.best).length && s.progress.settings.sound && s.board.reach==='near','Reset did not clear progress/settings'); break;
            case 'firstDelivery': assert(s.progress.missions.m01 && s.missionOneMs>0 && s.missionOneMs<=50_000,'Mission 1 exceeded 50 seconds'); emit(`METRIC mission 1 scripted ${Math.round(s.missionOneMs)} ms (includes CLI overhead)`); break;
            case 'autoMission2': assert(s.mission==='m02' && s.phase==='editing','Mission 2 did not arrive without a menu'); break;
            case 'agroundPreview':
              assert(s.tick===3 && s.phase==='editing' && s.outcome.failures[0].kind==='aground','Expected aground preview'); assert(s.status.includes('bar is dry at tick 3'),'Missing failure reason'); previewFrames=s.frames; break;
            case 'agroundLaunch': assert(s.phase==='failure' && s.outcome.failures[0].kind==='aground' && same(s.frames,previewFrames),'Launch/preview failure differs'); break;
            case 'undoAground': assert(s.phase==='editing' && s.placements.length===1 && s.placements[0].x===1,'Failure undo mismatch'); break;
            case 'carriedLock': assert(s.carried.length===1 && !s.placements.length,'Lock not held'); break;
            case 'trackingRecovered': assert(!s.carried.length && !s.placements.length && s.remaining.lock===1,'Tracking loss placed/duplicated/stuck piece'); break;
            case 'lockWait2': assert(s.placements.find(p=>p.piece==='lock')?.wait===2,'Lock tap did not cycle wait'); break;
            case 'holdRemoved': assert(s.placements.length===1 && s.placements[0].piece==='lock','Poke hold did not remove once'); break;
            case 'farReach': assert(s.board.reach==='far','Far reach did not apply'); break;
            case 'movedBoard': assert(s.board.position[0]>0.03,'Poke move arrow did not move board'); break;
            default: throw new Error(`Unknown check ${action.check}`);
          }
        }
      }
      const line=`PASS ${scenario.name}`; lines.push(line); emit(line);
    } catch (error) {
      const line=`FAIL ${scenario.name} at action ${actionNumber}: ${error.message}`; lines.push(line); emit(line); throw error;
    }
  }
  return lines;
}
