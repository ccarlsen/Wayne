exports.chatInputFocus = function() {
	$('#send').focus();
}

exports.timeAgo = function() {
	$('time').timeago();
}

exports.scrollToBottom = function() {
	$('#chat').animate({scrollTop: $('#chat').prop('scrollHeight')}, 200);
}

function escapeHTML(string) {
	return String(string)
	.replace(/&/g, '&amp;')
	.replace(/"/g, '&quot;')
	.replace(/'/g, '&#39;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/\t/g, '&nbsp;&nbsp;&nbsp;')
	.replace(/\n/g, '<br/>');
}

function escapeRegExp(string) {
	if(string){
		return string.replace(/(['()|\[\]\/\\])/g, '\\$1');
	}
}

function linkify(content) {
	var replacePattern1, replacePattern2;

	replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
	content = content.replace(replacePattern1, '<a href="$1">$1</a>');

	replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
	content = content.replace(replacePattern2, '$1<a href="http://$2">$2</a>');

	return content;
}

function emojify(inputText) {
	var emoji = [
		{ "file": "crying.svg", "shortcut": ":'(" },
		{ "file": "dissapointed.svg", "shortcut": "-_-" },
		{ "file": "smile.svg", "shortcut": ":)" },
		{ "file": "sad.svg", "shortcut": ":(" },
		{ "file": "laugh.svg", "shortcut": ":D" },
		{ "file": "surprised.svg", "shortcut": ":O" },
		{ "file": "tongue.svg", "shortcut": ":P" },
		{ "file": "worried.svg", "shortcut": ":S" },
		{ "file": "wink.svg", "shortcut": ";)" }
	];

	$.each(emoji, function(key, value) {
		var replacePattern = new RegExp(escapeRegExp(value.shortcut), 'g');
		inputText = inputText.replace(replacePattern,
			'<img src="assets/img/emoji/' + value.file + '" class="emoji" title="' + value.shortcut + '">');
	});

	return inputText;
}

exports.getProcessedMessage = function(content) {

	var imageRegex 	= /(\/image https?:\/\/.*\.(?:png|jpg|gif))/g;
	var imageTest 	= imageRegex.test(content);
	var imageURL 	= content.replace('/image ', '');

	if (imageTest) {
		content = '<div class="image"><div class="inner"><img src="'+ imageURL +'"><span><a href="'+ imageURL +'">'+ imageURL +'</a></span></div></div>';
	} else {
		content = escapeHTML(content);
		content = linkify(content);
		content = emojify(content);
	}

	return content;
}