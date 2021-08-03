import { interval, fromEvent, from, zip } from 'rxjs'
import { map, scan, filter, merge, flatMap, take, concat, takeUntil, mapTo} from 'rxjs/operators'

// vector class from asteroids
class Vec {
  constructor(public readonly x: number = 0, public readonly y: number = 0) {}
  add = (b:Vec) => new Vec(this.x + b.x, this.y + b.y)
  sub = (b:Vec) => this.add(b.scale(-1))
  len = ()=> Math.sqrt(this.x*this.x + this.y*this.y)
  scale = (s:number) => new Vec(this.x*s,this.y*s)
  ortho = ()=> new Vec(this.y,-this.x)
  rotate = (deg:number) =>
            (rad =>(
                (cos,sin,{x,y})=>new Vec(x*cos - y*sin, x*sin + y*cos)
              )(Math.cos(rad), Math.sin(rad), this)
            )(Math.PI * deg / 180)

  static unitVecInDirection = (deg: number) => new Vec(0,-1).rotate(deg)
  static Zero = new Vec();
}
// constants 
const 
  Constants = new class {
    readonly CanvasSize = 600;
    readonly PaddleWidth = 10;
    readonly BallExpirationTime = 1000;
    readonly StartTime = 0;
    readonly paddleWidth = 10;
    readonly roundsToWin = 7;
    readonly ballStartSpeed = new Vec(-2,1);
    readonly playerMoveSpeed = 4;
    readonly computerMoveSpeed = 4;
  }
type Key = 'ArrowUp' | 'ArrowDown' | 'Space'
type Event = 'keydown' | 'keyup'
type ViewType = 'player' | 'computer' | 'ball' | 'botBound' | 'topBound' | 'playerGoal' | 'computerGoal'

function pong() {
    // Inside this function you will use the classes and functions 
    // from rx.js
    // to add visuals to the svg element in pong.html, animate them, and make them interactive.
    // Study and complete the tasks in observable exampels first to get ideas.
    // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
    // You will be marked on your functional programming style
    // as well as the functionality that you implement.
    // Document your code! 
    class Move { constructor(public readonly distance:number) {} }
    class Restart { constructor() {} }
    const keyObservable = <T>(e:Event, k:Key, result: ()=>T)=>
      /**
       * produces stream of key presses without repeats
       * 
       * @param e - The type of event being processed, whether if the key is being pressed or released
       * @param key - The type of key being processed, whether if its arrowUp or arrowDown
       * @return  An observable stream of key presses that corresponds to the combination of keyup,keydown,ArrowUp,ArrowDown
       */
      fromEvent<KeyboardEvent>(document,e)
        .pipe(
          filter(({code})=>code === k),
          filter(({repeat})=>!repeat),
          map(result)),
      // creates streams for the combination of keyup,keydown,ArrowUp,ArrowDown
      startMoveUp = keyObservable('keydown', 'ArrowUp', ()=>new Move(-Constants.playerMoveSpeed)),
      startMoveDown = keyObservable('keydown', 'ArrowDown', ()=>new Move(Constants.playerMoveSpeed)),
      stopMoveUp = keyObservable('keyup', 'ArrowUp', ()=>new Move(0)),
      stopMoveDown = keyObservable('keyup', 'ArrowDown', ()=>new Move(0)),
      restart = keyObservable('keydown', 'Space', ()=>new Restart()) 
    // declare type for in game objects e.g. paddle, ball, goal etc.
    type Body = Readonly<{
      id:string,
      viewType:ViewType,
      pos:Vec,
      vel:Vec,
      acc:number,
      radius: number,
      orientation: string
    }>
    // declare type for game state that records all object instances and round data
    type State = Readonly<{
      player:Body,
      computer:Body,
      ball:Body,
      topBound: Body,
      botBound: Body,
      playerGoal: Body,
      computerGoal: Body,
      playerScore: number,
      computerScore: number,
      gameOver:boolean
    }>
    /**
     * Produces body type data defining a paddle 
     * 
     * @param id - the term used to refer to paddle object
     * @param viewType - the viewing type for paddle data
     * @param pos - The position of the paddle object
     * @return Data structure describing paddle object
     */
    const createPaddle = (id:string) => (viewType: ViewType) => (pos:Vec)=>
      <Body>{
        id: id,
        viewType: viewType,
        pos: pos,
        vel:Vec.Zero,
        acc:1,
        radius: 25,
        orientation: 'v'
      };
    /**
     * Produces the line object used for marking boundaries within game
     * 
     * @param id - The term used to refer to the line object
     * @param viewType - The viewing type for line data
     * @param pos - The position of the line object
     * @param orient - The orientation of the line where it can be either vertical or horizontal
     * @return Data structure describing line/boundary object
     */
    const createLine = (id:string) => (viewType: ViewType) => (pos:Vec) => (orient:string)=>
      <Body>{
        id: id,
        viewType: viewType,
        pos: pos,
        vel:Vec.Zero,
        acc: 1,
        radius: Constants.CanvasSize/2,
        orientation:orient
      };
    /**
     * Produces the ball object used in game
     * 
     * @param pos - The position of the ball object
     * @param vel - The velocity of the ball
     * @param acc - The acceleration factor of the ball in the y-direction
     * @return Data structure describing the ball object
     */
    const createBall = (pos:Vec) => (vel:Vec) => (acc: number) =>
      <Body>{
        id: 'ball',
        viewType: 'ball',
        pos: pos,
        vel: vel,
        acc: acc,
        radius: 5,
        orientation: 'v'
      }
    const 
      // Initialize the initial state of the game
      initialState:State = {
        player: createPaddle('player')('player')(new Vec(Constants.CanvasSize/8, Constants.CanvasSize/2)),
        computer: createPaddle('computer')('computer')(new Vec(7*Constants.CanvasSize/8, Constants.CanvasSize/2)),
        ball:createBall(new Vec(Constants.CanvasSize/2, Constants.CanvasSize/2))(Constants.ballStartSpeed)(1),
        topBound: createLine('topBound')('topBound')(new Vec(Constants.CanvasSize/2, 0))('h'),
        botBound: createLine('botBound')('botBound')(new Vec(Constants.CanvasSize/2, Constants.CanvasSize))('h'),
        playerGoal: createLine('playerGoal')('playerGoal')(new Vec(0, Constants.CanvasSize/2))('v'),
        computerGoal: createLine('computerGoal')('computerGoal')(new Vec(Constants.CanvasSize, Constants.CanvasSize/2))('v'),
        playerScore: 0,
        computerScore: 0,
        gameOver: false
      },
      /**
       * Moves object in game by creating object instance and changing position on board and velocity of object
       * 
       * @param o - the object being moved
       * @return new data structure representing of the object after being moved and applied acceleration on y axis
       */
      moveObj = (o:Body) => <Body>{
        ...o,
        pos:o.pos.add(o.vel),
        vel:new Vec(o.vel.x, o.vel.y*o.acc) // acceleration computed by multiplying acceleration factor to y velocity
      },
      /**
       * Computes the velocity for the computer paddle
       * 
       * @param s - the state of the game
       * @param o - the computer object to be moved
       * @return the new computer velocity based on the position of the ball and the velocity is limited by the constant computerMoveSpeed
       */
      computeComputerVel = (s:State) => (o:Body) => <Body>{
        ...o,
        // move up if ball above paddle
        vel: o.pos.y > s.ball.pos.y ? new Vec(0, -Constants.computerMoveSpeed) :
        // move down if ball below paddle
        o.pos.y+2*o.radius < s.ball.pos.y ? new Vec(0, Constants.computerMoveSpeed) :
        // otherwise don't move
        Vec.Zero
      },
      /**
       * Handles object interaction with the game
       * 
       * @param s - the most recent state of the game
       * @return the new state of the game after processing object interaction
       */
      objectInteraction = (s:State) => {
        const
          /**
           * Compute if any objects has collided with the ball
           * 
           * @param a - the data representing the rectnagle or line that collides with the ball
           * @param b - the data representing the ball
           * @return boolean value where true means collision and false means no collision  Constants.paddleWidth/4
           */
          bodiesCollided = (a:Body, b:Body) => a.orientation==='v' ? 
          //note: A MUST BE RECTANGLE/LINE B MUST BE BALL 
            a.viewType === 'player'||'computer' ?
            // if colided with paddle
            a.pos.y+2*a.radius>b.pos.y&&a.pos.y-a.radius<b.pos.y&&a.pos.x<b.pos.x&&a.pos.x+Constants.paddleWidth/4>b.pos.x : 
            // if collided with goal
            b.pos.x < 0 || b.pos.x > Constants.CanvasSize :
            // if collided with wall
            b.pos.y >= Constants.CanvasSize || b.pos.y <= 0,
          /**
           * Finds the acceleration of the ball based on the position of collision between the paddle and ball
           * 
           * @param a - Data representing the paddle 
           * @param b - Data representing the ball
           * @return number representing the acceleration factor 
           */
          computeAcceleration = (a:Body, b:Body) => 
            b.pos.y < a.pos.y+a.radius/2 || b.pos.y > a.pos.y+3*a.radius/2 ? 3 : // if hit paddle top/bottom quarter then double speed
            b.pos.y > a.pos.y+7*a.radius/8 && b.pos.y < a.pos.y+9*a.radius/8 ? 0.5: // if hit paddle middle then halve speed
            1, // otherwise same speed
          /**
           * Creates a new ball with the new deflection angle (90 degrees) applied to its velocity based on the collision object
           * 
           * @param a - boolean representing if collide with player paddle
           * @param b - boolean representing if collide with computer paddle
           * @param c - boolean representing if collide with top boundary
           * @param d - boolean representing if collide with bottom boundary
           * @param acceleration - number representing acceleration factor
           */
          rebound = (a:boolean, b:boolean, c:boolean, d:boolean) => (acceleration: number) =>
            a||b ? createBall(s.ball.pos)(new Vec(-s.ball.vel.x, s.ball.vel.y))(acceleration) : // if hit paddle
            c||d ? createBall(s.ball.pos)(new Vec(s.ball.vel.x, -s.ball.vel.y))(acceleration) : // if hit boundary
            createBall(s.ball.pos)(s.ball.vel)(acceleration), 
          // determine if ball collides with all objects
          playerCollision = bodiesCollided(s.player, s.ball),
          computerCollision = bodiesCollided(s.computer, s.ball),
          topBoundCollision = bodiesCollided(s.topBound, s.ball),
          botBoundCollision = bodiesCollided(s.botBound, s.ball),
          enterPlayerGoal = bodiesCollided(s.playerGoal, s.ball),
          enterComputerGoal = bodiesCollided(s.computerGoal, s.ball),
          // determine new acceleration factor if hit any paddle
          acceleration = playerCollision ? computeAcceleration(s.player, s.ball) : computerCollision ? computeAcceleration(s.computer, s.ball) : 1
        // return initial state but updated score 
        return s.gameOver ? 
        <State>{
          ...initialState,
          playerScore: s.playerScore,
          computerScore: s.computerScore,
          gameOver: true
        } :
        enterPlayerGoal || enterComputerGoal ? 
        <State>{
          ...initialState,
          ball: enterPlayerGoal ? 
            createBall(new Vec(Constants.CanvasSize/2, Constants.CanvasSize/2))(Constants.ballStartSpeed)(1) : enterComputerGoal ?
            createBall(new Vec(Constants.CanvasSize/2, Constants.CanvasSize/2))(Constants.ballStartSpeed.rotate(180))(1) : s.ball,
          playerScore: enterComputerGoal? s.playerScore+1 : s.playerScore,
          computerScore: enterPlayerGoal? s.computerScore+1 : s.computerScore
        } :
        // return same state but with new ball velocity (speed and direction) and new acceleration factor and update gameOver
        <State>{
          ...s,
          ball: rebound(playerCollision, computerCollision, topBoundCollision, botBoundCollision)(acceleration),
          gameOver: s.playerScore === Constants.roundsToWin || s.computerScore === Constants.roundsToWin
        } 
      },
      /**
       * Does operations on objects per every stream input
       * 
       * @param s - State of the current game
       * @return the state of the game with the operations applied to the objects
       */
      tick = (s:State) => {
        return objectInteraction({...s,
          player: moveObj(s.player),
          computer: moveObj(computeComputerVel(s)(s.computer)),
          ball: moveObj(s.ball)
        })
      },
      /**
       * Combines the possible player actions and calls tick to update the state of the game
       * 
       * @param s - state of the current game
       * @param e - the merged stream of possible player actions
       * @return new state of the game with updated values from performing operations 
       */
      reduceState = (s:State, e:Move|Restart)=>
        e instanceof Move ? {...s,
          player: {...s.player,vel: new Vec(0, e.distance)}
        } : 
        e instanceof Restart ? initialState :
        tick(s)
      //Main stream that runs the game
      const subscription = interval(10).pipe(
          merge(
            startMoveDown, startMoveUp, stopMoveDown, stopMoveUp),
          merge(restart),
          scan(reduceState, initialState)
      ).subscribe(updateView)
      /**
       * updates the visuals of the game by referring to the svg elements
       * 
       * @param s - the current state of the game
       * @return void 
       */
      function updateView(s: State){
        const
          svg = document.getElementById("canvas")!,
          attr = (e:Element,o:Object) =>
            { for(const k in o) e.setAttribute(k,String(o[k])) },
          player = document.getElementById("player")!,
          computer = document.getElementById("computer")!,
          ball = document.getElementById("ball")!,
          computerScore = document.getElementById("computerScore")!,
          playerScore = document.getElementById("playerScore")!,
          gameWin = document.getElementById("gameWin")!,
          gameLose = document.getElementById("gameLose")!
        player.setAttribute('transform',
          `translate(${s.player.pos.x},${s.player.pos.y})`    
        )
        computer.setAttribute('transform',
          `translate(${s.computer.pos.x},${s.computer.pos.y})`    
        )
        ball.setAttribute('transform',
          `translate(${s.ball.pos.x},${s.ball.pos.y})`    
        )
        computerScore.textContent = s.computerScore.toString()
        playerScore.textContent = s.playerScore.toString()
        // unsubscribe and print game over when game is over
        if (s.gameOver){
          // reveal You win if win, You Lose if lost
          s.playerScore===Constants.roundsToWin ? gameWin.classList.remove('hidden') : gameLose.classList.remove('hidden')
        }
        else{
          // hide text 
          gameWin.classList.add('hidden');
          gameLose.classList.add('hidden');
        }
      }
}     

  
  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      pong();
    }
  
  
