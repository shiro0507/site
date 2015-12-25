/* ============================================================================
 *
 * TODO:
 *  − CSV などから描画する元データを取得する
 *  − 最初のレンダリングまで24日にもっていけないと調整が難しい状況になる
 *
 * ========================================================================= */

/*global gl3 */
/*global SimpleAjax */
/*global GMTParser */


(function(){
    'use strict';
    var gmt, lonlat, price, maxPrice, gl, run;
    var canvasWidth, canvasHeight, canvasSize;
    var zoom, zoomLevel, zoomPower;
    var dragMode = false;
    var qt = gl3.qtn.create();
    gl3.qtn.identity(qt);

    // const
    // var JAPAN_LAT = 38.0;      // 初期カメラ座標
    // var JAPAN_LON = 140.0;     // 初期カメラ座標
    var JAPAN_HEIGHT = 3000.0;  // カメラの地表からの距離
    var EARTH_RADIUS = 6371.0;  // 地球の半径
    var ZOOM_DEFAULT = -1000.0; // カメラのデフォルト距離
    var ZOOM_MIN = -2950.0;     // 相対距離
    var ZOOM_MAX = -1000.0;     // 相対距離
    var ZOOM_SPEED = 50.0;      // 加算される加速度
    var ZOOM_RATIO = 1.0;       // ズームの距離に応じてドラッグ速度などを変えるための係数
    var HEEL = 8.0;             // 高さに履かせる下駄(値が低すぎると見えないので)
    var TOWER_WIDTH = 0.02;     // 柱の幅

    window.addEventListener('load', function(){ // onload event ---------------
        gl3.initGL('canvas');
        if(!gl3.ready){console.log('initialize error'); return;}
        gl = gl3.gl;
        gl3.ext = gl.getExtension('OES_element_index_uint');

        // // dom layer(default count is 3)
        // layers = [];
        // var i = 0;
        // while(document.getElementById('layer' + (++i))){
        //     layers[i - 1] = document.getElementById('layer' + i);
        // }

        // dom and event setting
        canvasSize = Math.min(window.innerWidth, window.innerHeight);
        gl3.canvas.width  = canvasWidth = window.innerWidth;
        gl3.canvas.height = canvasHeight = window.innerHeight;
        gl3.canvas.addEventListener('contextmenu', function(eve){eve.preventDefault();}, false);
        gl3.canvas.addEventListener('mousemove', mouseMove, false);
        gl3.canvas.addEventListener('mousedown', mouseDown, false);
        gl3.canvas.addEventListener('mouseup', mouseUp, false);
        gl3.canvas.addEventListener('wheel', mouseWheel, false);
        window.addEventListener('keydown', keyDown, false);

        var startTime = Date.now();
        console.log('◆ resources load start > image files');
        gl3.create_texture('./images/lenna.jpg', 0, gmtLoad);

        function gmtLoad(){
            console.log('timestamp: ' + (Date.now() - startTime));
            console.log('◆ image file loaded > NEXT > gmt files');
            gmt = new GMTParser('./resources/japanline-gmt-medium.dat', function(){
                console.log('timestamp: ' + (Date.now() - startTime));
                console.log('◆ gmt files loaded > NEXT > lanlot_data');
                lonlatLoad();
            });
        }
        function lonlatLoad(){
            var ax = new SimpleAjax(function(){
                try{
                    lonlat = JSON.parse(ax.getResponse());
                }catch(err){
                    console.warn('ajax error');
                    console.log(err);
                    return;
                }
                console.log('timestamp: ' + (Date.now() - startTime));
                console.log('◆ lanlot_data loaded > NEXT > rectprice_data');
                rectPriceDataLoad();
            });
            var path = './resources/lonlat.json';
            ax.initialize();
            ax.requestPost(path, {path: path});
        }
        function rectPriceDataLoad(){
            var ax = new SimpleAjax(function(){
                var i, j, r, s, t;
                price = {};
                maxPrice = 0;
                r = ax.getResponse();
                s = r.split('\n');
                for(i = 0, j = s.length; i < j; ++i){
                    t = s[i].split(',');
                    if(t != null && t[0] !== ''){
                        price[t[0]] = parseInt(t[1]);
                        maxPrice = Math.max(maxPrice, price[t[0]]);
                    }
                }
                console.log(price);
                console.log('timestamp: ' + (Date.now() - startTime));
                console.log('◆ rectprice_data loaded > NEXT > initialize!');
                init();
            });
            var path = 'http://www.digirea.com/temp/webgl_demo/resources/he-be-tanka.csv';
            ax.initialize();
            ax.requestPost(path, {path: path});
        }
    }, false); // onload event ------------------------------------------------

    function init(){
        var i, j;
        var prg = gl3.program.create(
            'scene_vs',
            'scene_fs',
            ['position', 'color', 'texCoord'],
            [3, 4, 2],
            ['mvpMatrix', 'texture'],
            ['matrix4fv', '1i']
        );
        if(prg == null){return;}
        var lPrg = gl3.program.create(
            'line_vs',
            'line_fs',
            ['position', 'color', 'texCoord'],
            [3, 4, 2],
            ['mMatrix', 'mvpMatrix', 'cameraPosition', 'ambient', 'tower', 'towerScale'],
            ['matrix4fv', 'matrix4fv', '3fv', '4fv', '1i', '1f']
        );
        if(lPrg == null){return;}
        var pPrg = gl3.program.create(
            'direct_vs',
            'direct_fs',
            ['position'],
            [3],
            ['texture'],
            ['1i']
        );
        if(pPrg == null){return;}

        // model deta format
        function Model(){
            this.position = null;
            this.color = null;
            this.texCoord = null;
            this.VBOList = null;
            this.vertexLength = 0;
            this.IBO = null;
            this.indexLength = 0;
            this.meshNodeIndex = 0;
            this.primitiveType = gl.POINTS;
        }
        // model[0] == earth sphere, [1] == gmt, [2] == price data
        var model = [];
        j = 3;
        for(i = 0; i < j; ++i){
            model[i] = new Model();
        }
        // earth sphere
        var position = [];
        var color    = [];
        var texCoord = [];
        (function(r, c, S, C){
            var i, j, k, l, m, n, o, p, q, s, t, u, v, w, x, y, z, A;
            var col;
            if(C == null){
                col = [1.0, 1.0, 1.0, 1.0];
            }else{
                col = C;
            }
            k = Math.PI / r;
            l = Math.PI * 2 / c;
            for(i = 0; i < r; ++i){
                x = Math.sin(i * k);
                y = Math.sin((i + 1) * k);
                m = S * Math.cos(i * k);
                n = S * Math.cos((i + 1) * k);
                t = i / r;
                u = (i + 1) / r;
                for(j = 0; j < c; ++j){
                    o = S * Math.sin(j * l) * x;
                    q = S * Math.cos(j * l) * x;
                    z = S * Math.sin(j * l) * y;
                    A = S * Math.cos(j * l) * y;
                    p = S * Math.sin((j + 1) * l) * y;
                    s = S * Math.cos((j + 1) * l) * y;
                    v = j / c;
                    w = (j + 1) / c;
                    if(i !== (r - 1)){
                        position.push(q, m, o, A, n, z, A, n, z, s, n, p);
                        color.push(col[0], col[1], col[2], col[3], col[0], col[1], col[2], col[3], col[0], col[1], col[2], col[3], col[0], col[1], col[2], col[3]);
                        texCoord.push(v, t, v, u, v, u, w, u);
                    }else{
                        position.push(q, m, o, A, n, z);
                        color.push(col[0], col[1], col[2], col[3], col[0], col[1], col[2], col[3]);
                        texCoord.push(v, t, v, u);
                    }
                }
            }
        })(180, 360, EARTH_RADIUS, [0.3, 0.3, 0.7, 1.0]);
        model[0].position = gl3.create_vbo(position);
        model[0].color    = gl3.create_vbo(color);
        model[0].texCoord = gl3.create_vbo(texCoord);
        model[0].VBOList  = [model[0].position, model[0].color, model[0].texCoord];
        model[0].vertexLength = position.length / 3;
        model[0].primitiveType = gl.LINES;
        // japan lines
        model[1].position = gl3.create_vbo(gmt.position);
        model[1].color    = gl3.create_vbo(gmt.color);
        model[1].texCoord = gl3.create_vbo(gmt.texCoord);
        model[1].VBOList  = [model[1].position, model[1].color, model[1].texCoord];
        model[1].vertexLength = gmt.position.length / 3;
        model[1].primitiveType = gl.LINES;
        // price data
        position = [];
        color    = [];
        texCoord = [];
        (function(){
            var i, j, k, m, n, o, p;
            var lon, lat, r, ry, rr, tr, tx, ty, tz;
            var l = [];
            var v = [];
            var w = [];
            var u = [];
            v[0] = [-TOWER_WIDTH,  TOWER_WIDTH];
            v[1] = [ TOWER_WIDTH,  TOWER_WIDTH];
            v[2] = [-TOWER_WIDTH, -TOWER_WIDTH * 0.85];
            v[3] = [ TOWER_WIDTH, -TOWER_WIDTH * 0.85];
            n = HEEL / EARTH_RADIUS;
            for(i in lonlat){if(lonlat.hasOwnProperty(i)){
                for(j in lonlat[i]){if(lonlat[i].hasOwnProperty(j)){
                    if(price.hasOwnProperty(i + j)){
                        k = price[i + j];
                        p = (0.6 - k / maxPrice * 0.6) * 360.0;
                        l[0] = hsva(p, 1.0, 1.0, 1.0);
                        l[1] = hsva(p, 1.0, 0.8, 1.0);
                        l[2] = hsva(p, 1.0, 0.6, 1.0);
                        m = (k / maxPrice) / 50.0 + 1.0 + n;
                        for(o = 0; o < 4; ++o){
                            lon = lonlat[i][j].lon + v[o][0];
                            lat = lonlat[i][j].lat + v[o][1];
                            r = Math.PI / 180 * (lat - 90);
                            ry = Math.cos(r);
                            rr = Math.sin(r);
                            tr = Math.PI / 180 * -lon;
                            tx = rr * EARTH_RADIUS * Math.cos(tr);
                            ty = ry * EARTH_RADIUS;
                            tz = rr * EARTH_RADIUS * Math.sin(tr);
                            w[o] = [tx, ty, tz];
                            u[o] = [tx * m, ty * m, tz * m];
                        }
                        position.push(
                            w[0][0], w[0][1], w[0][2],
                            w[2][0], w[2][1], w[2][2],
                            w[1][0], w[1][1], w[1][2],
                            w[1][0], w[1][1], w[1][2],
                            w[2][0], w[2][1], w[2][2],
                            w[3][0], w[3][1], w[3][2],
                            u[0][0], u[0][1], u[0][2],
                            u[2][0], u[2][1], u[2][2],
                            u[1][0], u[1][1], u[1][2],
                            u[1][0], u[1][1], u[1][2],
                            u[2][0], u[2][1], u[2][2],
                            u[3][0], u[3][1], u[3][2]
                        );
                        position.push(
                            u[0][0], u[0][1], u[0][2],
                            w[0][0], w[0][1], w[0][2],
                            u[1][0], u[1][1], u[1][2],
                            u[1][0], u[1][1], u[1][2],
                            w[0][0], w[0][1], w[0][2],
                            w[1][0], w[1][1], w[1][2],
                            u[2][0], u[2][1], u[2][2],
                            w[2][0], w[2][1], w[2][2],
                            u[3][0], u[3][1], u[3][2],
                            u[3][0], u[3][1], u[3][2],
                            w[2][0], w[2][1], w[2][2],
                            w[3][0], w[3][1], w[3][2]
                        );
                        position.push(
                            u[0][0], u[0][1], u[0][2],
                            w[0][0], w[0][1], w[0][2],
                            u[2][0], u[2][1], u[2][2],
                            u[2][0], u[2][1], u[2][2],
                            w[0][0], w[0][1], w[0][2],
                            w[2][0], w[2][1], w[2][2],
                            u[1][0], u[1][1], u[1][2],
                            w[1][0], w[1][1], w[1][2],
                            u[3][0], u[3][1], u[3][2],
                            u[3][0], u[3][1], u[3][2],
                            w[1][0], w[1][1], w[1][2],
                            w[3][0], w[3][1], w[3][2]
                        );
                        color.push(
                            l[0][0], l[0][1], l[0][2], l[0][3], l[0][0], l[0][1], l[0][2], l[0][3],
                            l[0][0], l[0][1], l[0][2], l[0][3], l[0][0], l[0][1], l[0][2], l[0][3],
                            l[0][0], l[0][1], l[0][2], l[0][3], l[0][0], l[0][1], l[0][2], l[0][3],
                            l[0][0], l[0][1], l[0][2], l[0][3], l[0][0], l[0][1], l[0][2], l[0][3],
                            l[0][0], l[0][1], l[0][2], l[0][3], l[0][0], l[0][1], l[0][2], l[0][3],
                            l[0][0], l[0][1], l[0][2], l[0][3], l[0][0], l[0][1], l[0][2], l[0][3]
                        );
                        color.push(
                            l[1][0], l[1][1], l[1][2], l[1][3], l[1][0], l[1][1], l[1][2], l[1][3],
                            l[1][0], l[1][1], l[1][2], l[1][3], l[1][0], l[1][1], l[1][2], l[1][3],
                            l[1][0], l[1][1], l[1][2], l[1][3], l[1][0], l[1][1], l[1][2], l[1][3],
                            l[1][0], l[1][1], l[1][2], l[1][3], l[1][0], l[1][1], l[1][2], l[1][3],
                            l[1][0], l[1][1], l[1][2], l[1][3], l[1][0], l[1][1], l[1][2], l[1][3],
                            l[1][0], l[1][1], l[1][2], l[1][3], l[1][0], l[1][1], l[1][2], l[1][3]
                        );
                        color.push(
                            l[2][0], l[2][1], l[2][2], l[2][3], l[2][0], l[2][1], l[2][2], l[2][3],
                            l[2][0], l[2][1], l[2][2], l[2][3], l[2][0], l[2][1], l[2][2], l[2][3],
                            l[2][0], l[2][1], l[2][2], l[2][3], l[2][0], l[2][1], l[2][2], l[2][3],
                            l[2][0], l[2][1], l[2][2], l[2][3], l[2][0], l[2][1], l[2][2], l[2][3],
                            l[2][0], l[2][1], l[2][2], l[2][3], l[2][0], l[2][1], l[2][2], l[2][3],
                            l[2][0], l[2][1], l[2][2], l[2][3], l[2][0], l[2][1], l[2][2], l[2][3]
                        );
                        texCoord.push(
                            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
                        );
                    }
                }}
            }}
        })();
        model[2].position = gl3.create_vbo(position);
        model[2].color    = gl3.create_vbo(color);
        model[2].texCoord = gl3.create_vbo(texCoord);
        model[2].VBOList  = [model[2].position, model[2].color, model[2].texCoord];
        model[2].vertexLength = position.length / 3;
        model[2].primitiveType = gl.TRIANGLES;

        var planePosition = [
            -1.0,  1.0,  0.0,
             1.0,  1.0,  0.0,
            -1.0, -1.0,  0.0,
             1.0, -1.0,  0.0
        ];
        var planeIndex = [
            0, 1, 2, 2, 1, 3
        ];
        var planeVBO = [gl3.create_vbo(planePosition)];
        var planeIBO = gl3.create_ibo(planeIndex, planePosition.length / 3);

        var mMatrix   = gl3.mat4.identity(gl3.mat4.create());
        var vMatrix   = gl3.mat4.identity(gl3.mat4.create());
        var pMatrix   = gl3.mat4.identity(gl3.mat4.create());
        var vpMatrix  = gl3.mat4.identity(gl3.mat4.create());
        var mvpMatrix = gl3.mat4.identity(gl3.mat4.create());
        var ertMatrix = gl3.mat4.identity(gl3.mat4.create());
        ertMatrix = [-0.21065671741962433, 0.7976622581481934, -0.5651183724403381, 0, 0.6013258099555969, 0.5615174770355225, 0.5684236884117126, 0, 0.770734429359436, -0.2200784832239151, -0.597940981388092, 0, 0, 0, 0, 1];

        // initial
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        var bufferSize = 2048;
        var fBuffer = gl3.create_framebuffer(bufferSize, bufferSize, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, gl3.textures[0].texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, gl3.textures[1].texture);

        var count = 0;
        var cameraDistance = gmt.earthRadius + JAPAN_HEIGHT;
        var cameraPosition = [];
        var centerPoint = [0.0, 0.0, gmt.earthRadius];
        var cameraUpDirection = [];
        zoom = 0;
        zoomLevel = 0;
        zoomPower = ZOOM_DEFAULT;

        console.log('rendering');
        run = true;
        render();

        function render(){
            count++;
            gl3.canvas.width = canvasWidth = window.innerWidth;
            gl3.canvas.height = canvasHeight = window.innerHeight;

            ZOOM_RATIO = 0.5 * Math.max((zoomPower - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN), 0.01);
            if(zoom !== 0){
                zoomLevel = zoom;
                zoom = 0;
            }
            zoomLevel *= 0.5;
            zoomPower += zoomLevel * ZOOM_SPEED * (ZOOM_RATIO * 4);
            zoomPower = Math.max(Math.min(zoomPower, ZOOM_MAX), ZOOM_MIN);
            gl3.qtn.toVecIII([0.0, 0.0, JAPAN_HEIGHT + zoomPower], qcty, cameraPosition);
            gl3.qtn.toVecIII([0.0, 1.0, 0.0], qcty, cameraUpDirection);
            gl3.qtn.toVecIII(cameraPosition, qctx, cameraPosition);
            gl3.qtn.toVecIII(cameraUpDirection, qctx, cameraUpDirection);
            cameraPosition[2] += gmt.earthRadius;
            var camera = gl3.camera.create(
                cameraPosition,
                centerPoint,
                cameraUpDirection,
                75, canvasWidth / canvasHeight, cameraDistance * 0.001, cameraDistance * 4.0
            );
            gl3.mat4.vpFromCamera(camera, vMatrix, pMatrix, vpMatrix);

            // earth rotate
            gl3.qtn.toMatIV(qt, mMatrix);
            gl3.mat4.multiply(mMatrix, ertMatrix, ertMatrix);
            gl3.qtn.identity(qt);

            // to framebuffer
            gl.disable(gl.BLEND);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fBuffer.framebuffer);
            gl3.scene_clear([0.05, 0.05, 0.05, 1.0], 1.0);
            gl3.scene_view(camera, 0, 0, bufferSize, bufferSize);

            // from gmt map
            lPrg.set_program();

            gl3.mat4.identity(mMatrix);
            gl3.mat4.multiply(mMatrix, ertMatrix, mMatrix);
            gl3.mat4.rotate(mMatrix, Math.PI, [0.0, 1.0, 0.0], mMatrix);
            gl3.mat4.multiply(vpMatrix, mMatrix, mvpMatrix);
            lPrg.push_shader([mMatrix, mvpMatrix, cameraPosition, [1.0, 1.0, 1.0, 1.0], false, 1.0]);
            gl.disable(gl.DEPTH_TEST);
            lPrg.set_attribute(model[0].VBOList, null);
            gl3.draw_arrays(model[0].primitiveType, model[0].vertexLength);
            lPrg.set_attribute(model[1].VBOList, null);
            gl3.draw_arrays(model[1].primitiveType, model[1].vertexLength);
            gl.enable(gl.DEPTH_TEST);
            lPrg.set_attribute(model[2].VBOList, null);
            gl3.draw_arrays(model[2].primitiveType, model[2].vertexLength);

            // to canvas
            gl.disable(gl.BLEND);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl3.scene_clear([0.3, 0.3, 0.3, 1.0], 1.0);
            gl3.scene_view(null, 0, 0, gl3.canvas.width, gl3.canvas.height);
            pPrg.set_program();
            pPrg.set_attribute(planeVBO, planeIBO);

            pPrg.push_shader([1]);
            gl3.draw_elements(gl.TRIANGLES, planeIndex.length);

            if(run){requestAnimationFrame(render);}
        }
    }

    // event ==================================================================
    var csx, csy;
    var dsx, dsy;
    var qtx = gl3.qtn.identity(gl3.qtn.create());
    var qty = gl3.qtn.identity(gl3.qtn.create());
    var qctx = gl3.qtn.identity(gl3.qtn.create());
    var qcty = gl3.qtn.identity(gl3.qtn.create());
    var qax = [];
    var qay = [];

    // default
    qctx = [0, 0, 0.07594597339630127, 0.9971119165420532];
    qcty = [-0.43857523798942566, -0, -0, 0.8986944556236267];
    csx = 0.04839530791788849;
    csy = -0.5780669144981435;

    function keyDown(eve){
        run = eve.keyCode !== 27;
    }
    function mouseWheel(eve){
        if(eve.deltaY > 0){zoom = -1;}
        if(eve.deltaY < 0){zoom =  1;}
        eve.preventDefault();
    }
    function mouseDown(eve){
        dragMode = true;
        dsx = eve.pageX;
        dsy = eve.pageY;
        eve.preventDefault();
    }
    function mouseUp(eve){
        dragMode = false;
        eve.preventDefault();
    }
    function mouseMove(eve){
        eve.preventDefault();
        if(!dragMode){return;}
        var cw = canvasWidth;
        var ch = canvasHeight;
        var x = (eve.pageX - dsx) / cw;
        var y = (eve.pageY - dsy) / ch;
        dsx = eve.pageX;
        dsy = eve.pageY;
        switch(eve.buttons){
            case 1:
                x *= ZOOM_RATIO; y *= ZOOM_RATIO;
                gl3.qtn.identity(qtx);
                gl3.qtn.identity(qty);
                gl3.qtn.toVecIII([0.0, 1.0, 0.0], qctx, qax);
                gl3.qtn.toVecIII([1.0, 0.0, 0.0], qctx, qay);
                gl3.qtn.rotate(-x, qax, qtx);
                gl3.qtn.rotate(-y, qay, qty);
                gl3.qtn.multiply(qtx, qty, qt);
                break;
            case 2:
                if(x + y > 0){zoom = -1;}
                if(x + y < 0){zoom =  1;}
                break;
            case 3:
                gl3.qtn.identity(qctx);
                gl3.qtn.identity(qcty);
                csx += x;
                if(csx < -1.0){csx += 2.0;}
                if(csx >  1.0){csx -= 2.0;}
                gl3.qtn.rotate(csx * Math.PI, [0.0, 0.0, 1.0], qctx);
                csy = Math.max(Math.min(csy + y, 1.0), -1.0);
                gl3.qtn.rotate(csy * Math.PI / 2, [1.0, 0.0, 0.0], qcty);
                break;
        }
    }
    function hsva(h, s, v, a){
        if(s > 1 || v > 1 || a > 1){return;}
        var th = h % 360;
        var i = Math.floor(th / 60);
        var f = th / 60 - i;
        var m = v * (1 - s);
        var n = v * (1 - s * f);
        var k = v * (1 - s * (1 - f));
        var color = [];
        if(s > 1 || s < 0){
            color.push(v, v, v, a);
        }else{
            var r = new Array(v, n, m, m, k, v);
            var g = new Array(k, v, v, n, m, m);
            var b = new Array(m, m, k, v, v, n);
            color.push(r[i], g[i], b[i], a);
        }
        return color;
    }
})();
