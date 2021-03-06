var express = require('express');
var jwt = require('jsonwebtoken');
var socketioJwt = require('socketio-jwt');
var app = express();
var bodyParser = require('body-parser');
var config = require('./config/cfg');
var mongo = require('./db');
var LEX = require('letsencrypt-express');
var https = require('spdy');
var http = require('http');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var gm = require('gm');

var multer  = require('multer');
var storageProperties = multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, config.http.uploadfolder)
    },
    filename: function (req, file, callback) {
        callback(null, Date.now() + '_' + file.originalname )
    }
});
var upload = multer({storage: storageProperties}).single('file');

var allowCrossDomain = function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
}

//Chat Variables
var users = {};
var sockets = [];

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(allowCrossDomain);
app.use(express.static(__dirname + '/public'));

app.post('/login', function (req, res) {
  mongo.userAuthenticate(req.body.username, req.body.password, function (isValid) {
    if(isValid){
      mongo.getFullUserByUsername(req.body.username, function (user) {
        var token = jwt.sign(user.toJSON() , config.crypto.jwtSecret, { expiresIn: "10h" });
        res.json({token: token});
      });
    } else {
      res.status(401).send({'message': 'login incorrect'});
    }
  });
});

app.get('/webms', function (req, res) {
	res.header("Content-Type", "application/json");
	mongo.getAllWebms(function(webms) {
		res.status(200).send(JSON.stringify(webms));
	});
});

app.delete('/webms/:id', function (req, res) {
  console.log('Deleting Webm: ' + req.params.id);
	mongo.deactivateWebmById(req.params.id, function() {
    res.send(req.body);
	});
});

app.get('/sounds', function (req, res) {
	res.header("Content-Type", "application/json");
	mongo.getAllSounds(function(sounds) {
		res.status(200).send(JSON.stringify(sounds));
	});
});

app.delete('/sounds/:id', function (req, res) {
  console.log('Deleting Sound: ' + req.params.id);
	mongo.deactivateSoundById(req.params.id, function() {
    res.send(req.body);
	});
});

app.post('/upload',function(req,res){
    upload(req,res,function(err) {
        if(err) {
            return res.end("error");
        }
        res.status(201).end(config.http.domain + '/uploads/'+ req.file.filename);
    });
});

//letsencrypt https config
var lex = LEX.create({
  server: config.letsencrypt.server,
  configDir: config.letsencrypt.configdir,
  approvedDomains: function (opts, certs, cb) {
    opts.domains = certs && certs.altnames || opts.domains;
    opts.email = config.letsencrypt.mail;
    opts.agreeTos = true;

    cb(null, { options: opts, certs: certs });
  }
});

var server
if(config.debug) {
  var server = http.createServer(app);
} else {
  server = https.createServer(lex.httpsOptions, lex.middleware(app));
}

var io = require('socket.io')(server);
server.listen(config.http.port, function () {
  console.log('Listening on ' + config.http.port, this.address());
});

io.use(socketioJwt.authorize({
  secret: config.crypto.jwtSecret,
  handshake: true
}));

io.sockets.on('connection', function (socket) {
  var docUser = socket.decoded_token;
  mongo.updateUserStatus(docUser.usr, 1, Date(), function() {
    mongo.getFullUserByUsername(docUser.usr, function (user) {
      console.log(user.firstname + ' is now online');
      users[socket.id] = user;
      sockets[user._id] = socket;
      socket.broadcast.emit('newUserOnline', user);
    });
  });

  socket.on('getUserStatus', function(){
    updateUserStatus();
  });

  function updateUserStatus(){
    mongo.getAllUser(function(users) {
      console.log('Get all users for status bar');
      io.sockets.emit('userStatusUpdate', users);
    });
  }

  //Load old messages
  socket.on('getOldMessages', function(){
    mongo.getLastMessages(10, function(messages){
      messages.reverse();
      console.log('Loaded old messages');
      socket.emit('loadOldMessages', messages);
    });
  });

  //Messages Chat to Chat
  socket.on('sendMessage', function(message){
    mongo.createNewMessage(users[socket.id]._id, message, null, function(done) {
      if(done) {
        io.sockets.emit('newMessage', {msg: message, user: users[socket.id], webm: null});
      }
    });
  });

  socket.on('sendWebm', function(webm){
    mongo.createNewMessage(users[socket.id]._id, null, webm, function(done) {
      if(done) {
        io.sockets.emit('newMessage', {msg: null, user: users[socket.id], webm: webm});
      }
    });
  });

  //Typing
  socket.on('startTyping', function(){
    socket.broadcast.emit('typing', {isTyping: true, user: users[socket.id].firstname});
  });

  socket.on('stopTyping', function(){
    socket.broadcast.emit('typing', {isTyping: false, user: users[socket.id].firstname});
  });

  socket.on('updateWebms', function(){
    io.sockets.emit('loadWebms');
  });

  socket.on('updateSounds', function(){
    io.sockets.emit('loadSounds');
  });

  socket.on('sendSound', function(id){
    io.sockets.emit('receiveSound', id);
  });

  //Upload GIF/WEBM
  //FFMPEG Installation:
  //install scripts/install_ffmpeg_ubuntu.sh
  socket.on('uploadGifWebm', function(content){
    sendBotMessage("Creating new GIF...");
    var fileUrl = content.url;
    var width = content.resizemode == 'w' ? content.size : '?';
    var height = content.resizemode == 'h' ? content.size : '?';
    var fileExtension = '.' + fileUrl.substr((~-fileUrl.lastIndexOf(".") >>> 0) + 2);
    var dest = './temp/temp' + fileExtension;
    var timestamp = new Date().getTime();
    var outputWebm = config.http.webmfolder + timestamp + '.webm';
    var outputThumb = config.http.thumbfolder + timestamp + '.png';
    download(fileUrl, dest, content.protocol, function(downloaded){
      if(downloaded) {
        //Creates webm
        var ffmpegcommand = ffmpeg(dest)
        .videoCodec('libvpx')
        .addOptions(['-crf 12'])
        .withVideoBitrate(1024)
        .output(outputWebm);

        if(width != '?'){
          ffmpegcommand.size(width + 'x?');
        } else if(height != '?') {
          ffmpegcommand.size('?x' + height);
        }

        ffmpegcommand.on('error', function(err, stdout, stderr) {
          sendBotMessage("Couldn't process '" + fileUrl + "' to GIF!");
          console.log('Cannot process video: ' + err.message);
        }).on('end', function() {
          console.log('Processing finished...taking thumbail!');
          //When webm created, create thumbail
          ffmpeg(dest)
          .addOptions(['-vframes 1'])
          .size('100x100')
          .output(outputThumb)
          .on('end', function() {
            //When thumbnail created, save to database
            ffmpeg.ffprobe(outputWebm, function(err, metadata) {
              mongo.createNewWebm(users[socket.id]._id,
                '/webm/' + timestamp + '.webm',
                '/thumbnails/' + timestamp + '.png',
				config.http.domain,
                '',
                1,
                metadata.streams[0].height,
                metadata.streams[0].width,
                function(saved) {
                  if(saved){
                    sendBotMessage("Done!");
                    io.sockets.emit('loadWebms');
                  }
                });
            });
          })
          .run();
        })
        .run();
      } else {
        sendBotMessage("Couldn't download the file!");
      }
    });
  });

  //Upload Sound (MP3,WAV,OGG)
  socket.on('uploadSound', function(content){
    sendBotMessage("Creating new Sound...");
    var fileUrl = content.url;
    var format = fileUrl.substr((~-fileUrl.lastIndexOf(".") >>> 0) + 2);
    var timestamp = new Date().getTime();
    var filename = timestamp + '.' + format;
    var dest = config.http.soundsfolder + filename;
    download(fileUrl, dest, content.protocol, function(downloaded){
      if(downloaded) {
        mongo.createNewSound(users[socket.id]._id, '/sounds/' + filename, config.http.domain, content.title, format, 1, function(saved) {
            if(saved){
              sendBotMessage("Done!");
              io.sockets.emit('loadSounds');
            }
          });
      } else {
        sendBotMessage("Couldn't download the file!");
      }
    });
  });

  //Update Avatar with resize to 100x100
  socket.on('updateAvatar', function(content){
    var fileUrl = content.url;
    var format = fileUrl.substr((~-fileUrl.lastIndexOf(".") >>> 0) + 2);
    var timestamp = new Date().getTime();
    var filename = timestamp + '.' + format;
	var dest = './temp/temp.' + format;
    var output = config.http.avatarfolder + filename;
    download(fileUrl, dest, content.protocol, function(downloaded){
      if(downloaded) {
		  gm(dest).resize(100, 100).write(output, function (err) {
			if (err) {
				sendBotMessage("Failed creating new avatar for " + users[socket.id].firstname  + "...");
			} else {
				var avatarLink = config.http.domain + '/avatars/' + filename;
				mongo.updateUserAvatar(users[socket.id]._id, avatarLink, function(saved) {
					users[socket.id].avatar = avatarLink;
					sendBotMessage(users[socket.id].firstname + " has a new avatar!");
				});
			}
		});
      } else {
        sendBotMessage("Couldn't download the file!");
      }
    });
  });

  //User disconnected
  socket.on('disconnect', function(){
		if(!users[socket.id]) return;
		mongo.updateUserStatus(users[socket.id].usr, 0, Date(), function() {
			console.log(users[socket.id].firstname + ' is now offline');
			delete sockets[users[socket.id]._id];
			delete users[socket.id];
			updateUserStatus();
		});
	});

  socket.on('error', function(error) {
    sendBotMessage("Error!");
    console.log(error);
  });
});


//Functions
var download = function(url, dest, protocol, cb) {
  var file = fs.createWriteStream(dest);
  if(protocol == 'http') {
    var request = http.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close();
        if (cb) cb(true);
      });
    }).on('error', function(err) {
      fs.unlink(dest);
      if (cb) cb(false);
    });
  } else if(protocol == 'https'){
    var request = require('https').get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close();
        if (cb) cb(true);
      });
    }).on('error', function(err) {
      fs.unlink(dest);
      if (cb) cb(false);
    });
  } else {
    cb(false);
  }
};

//Functions
var sendBotMessage = function(message) {
  var bot = {usr: 'Bot', avatar: 'https://thxma.de/avatars/bot.png'};
  io.sockets.emit('newMessage', {msg: message, user: bot});
};
