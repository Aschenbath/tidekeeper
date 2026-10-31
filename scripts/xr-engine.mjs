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
        if (action.wait) await call('browser','interact',{steps:[{action:'wait',durationMs:Math.round(action.wait * 1000)}]});
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
        if (action.check) {
          const s = await state();
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
