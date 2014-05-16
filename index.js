var through = require('through2');
var inherits = require('inherits');
var Duplex = require('readable-stream').Duplex;
var cssauron = require('cssauron');

var Select = require('./lib/select.js');
var parseTag = require('./lib/parse_tag.js');

module.exports = Plex;
inherits(Plex, Duplex);

function Plex (sel, cb) {
    if (!(this instanceof Plex)) return new Plex(sel, cb);
    Duplex.call(this, { objectMode: true });
    this._selectors = [];
    this._matching = null;
    this._pullQueue = [];
    
    this._root = {};
    this._current = this._root;
    
    this._lang = cssauron({
        tag: function (node) {
            if (node.tag) return node.tag;
            if (!node.row) return undefined;
            var p = parseTag(node.row[1]);
            node._parsed = p;
            node.tag = p.name;
            return node.tag;
        },
        class: function (node) { return getAttr(node, 'class') },
        id: function (node) { return getAttr(node, 'id') },
        parent: 'parent',
        children: 'children',
        attr: getAttr
    });
    if (sel && cb) this.select(sel, cb);
}
    
function getAttr (node, key) {
    if (node.attributes && !key) return node.attributes;
    else if (node.attributes) return node.attributes[key];
    if (!node._parsed) {
        if (!node.row) return undefined;
        var p = parseTag(node.row[1]);
        node._parsed = p;
        node.tag = p.tag;
    }
    node.attributes = node._parsed.getAttributes();
    if (!key) return node.attributes;
    else return node.attributes[key];
}

Plex.prototype.select = function (sel, cb) {
    var self = this;
    var pull = function () { self._advance() };
    var s = new Select(this._lang(sel), pull);
    s.on('match', function () {
        self._matching = s;
        if (cb) cb(s);
        s.output.pipe(through.obj(function (row, enc, next) {
            self.push(row);
            next();
        }));
        s.output.on('end', function () {
            self._matching = null;
            self._advance();
        });
    });
    this._selectors.push(s);
    return s;
};

Plex.prototype._pull = function (cb) {
    var buf = this._buffer;
    var next = this._next;
    if (buf) {
        this._buffer = null;
        this._next = null;
        cb(buf);
        next();
    }
    else {
        this._pullQueue.push(cb);
    }
};

Plex.prototype._read = function (n) {
    if (!this._matching) this._advance();
};

Plex.prototype._advance = function () {
    var self = this;
    this._pull(function (row) {
        self._updateTree(row);
        
        for (var i = 0, l = self._selectors.length; i < l; i++) {
            self._selectors[i]._exec(self._current, row);
        }
        if (!self._matching) self.push(row);
    });
};

Plex.prototype._updateTree = function (row) {
    if (row[0] === 'open') {
        var node = { parent: this._current, row: row };
        if (!this._current.children) this._current.children = [ node ]
        else this._current.children.push(node);
        this._current = node;
    }
    else if (row[0] === 'close') {
        if (this._current.parent) this._current = this._current.parent;
    }
};

Plex.prototype._write = function (buf, enc, next) {
    if (this._pullQueue.length) {
        this._pullQueue.shift()(buf);
        next();
    }
    else {
        this._buffer = buf;
        this._next = next;
    }
};

Plex.prototype._err = function (msg) {
    this.emit('error', new Error(msg));
};
