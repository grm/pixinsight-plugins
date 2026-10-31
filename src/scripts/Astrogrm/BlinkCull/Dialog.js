// Fenêtre : liste, aperçu, lecture, graphe, actions sur les fichiers.

function blinkVerdictColor( verdict )
{
   if ( verdict == "keep" )
      return 0xFF2F8F4E;
   if ( verdict == "review" )
      return 0xFFC47B12;
   if ( verdict == "reject" )
      return 0xFFC23B3B;
   return 0xFF888888;
}

function blinkFormat( value, digits )
{
   if ( !isFinite( value ) )
      return "";
   return format( "%." + digits + "f", value );
}

function blinkDisplayStretch( image )
{
   let color = image.isColor || image.numberOfChannels >= 3;
   let n = color ? 3 : 1;
   let H = [
      [ 0, 0.5, 1, 0, 1 ],
      [ 0, 0.5, 1, 0, 1 ],
      [ 0, 0.5, 1, 0, 1 ],
      [ 0, 0.5, 1, 0, 1 ],
      [ 0, 0.5, 1, 0, 1 ]
   ];
   for ( let c = 0; c < n; ++c )
   {
      let med = image.median( new Rect(), c, c );
      let mad = image.MAD( med, new Rect(), c, c ) * 1.4826;
      let c0 = 0;
      let m = 0.5;
      if ( isFinite( med ) && med <= 0.5 )
      {
         c0 = Math.range( med - 2.8 * mad, 0, 1 );
         let x = med - c0;
         if ( !( x > 0 ) )
            x = 1e-6;
         m = Math.mtf( 0.25, x );
         if ( !isFinite( m ) || m <= 0 || m >= 1 )
            m = 0.5;
      }
      let row = [ c0, m, 1, 0, 1 ];
      if ( color )
         H[ c ] = row;
      else
         H[ 3 ] = row;
   }
   let HT = new HistogramTransformation;
   HT.H = H;
   HT.executeOn( image );
}

function blinkReadPreview( filePath )
{
   let format = new FileFormat( blinkExtension( filePath ), true );
   let instance = new FileFormatInstance( format );
   let descriptions = instance.open( filePath, "verbosity 0" );
   if ( descriptions == null )
      throw new Error( "Aperçu impossible : " + filePath );
   let image = new Image;
   let ok = instance.readImage( image );
   instance.close();
   if ( !ok )
      throw new Error( "Lecture impossible : " + filePath );
   let edge = Math.max( image.width, image.height );
   if ( edge > 1200 )
      image.resample( 1200 / edge );
   blinkDisplayStretch( image );
   return image.render();
}

var BlinkCullDialog = class extends Dialog
{
   constructor()
   {
   super();

   this.session = new BlinkSession();
   this.mood = BLINK_MOODS.standard;
   this.filterMode = "all";
   this.playIndex = 0;
   this.playing = false;
   this.zoom = 1;
   this.focusX = 0.5;
   this.focusY = 0.5;
   this.previewBitmap = null;
   this.previewPath = "";
   this.cache = [];
   this.busy = false;

   let saved = Settings.read( "BlinkCull/root", DataType_String );
   if ( Settings.lastReadOK && saved )
      this.rootEditSeed = saved;
   else
      this.rootEditSeed = "";

   this.build();
   }
};

BlinkCullDialog.prototype.build = function()
{
   this.windowTitle = "Blink des poses";
   this.userResizable = true;
   this.scaledMinWidth = 1100;
   this.scaledMinHeight = 760;

   this.rootEdit = new Edit( this );
   this.rootEdit.text = this.rootEditSeed;
   this.rootEdit.setScaledMinWidth( 520 );

   this.browseButton = new PushButton( this );
   this.browseButton.text = "Parcourir";
   this.browseButton.onClick = function() { this.dialog.browse(); };

   this.scanButton = new PushButton( this );
   this.scanButton.text = "Analyser";
   this.scanButton.onClick = function() { this.dialog.scan(); };

   this.measureButton = new PushButton( this );
   this.measureButton.text = "Mesurer";
   this.measureButton.onClick = function() { this.dialog.measure(); };

   this.moodLabel = new Label( this );
   this.moodLabel.text = "Sévérité";
   this.moodLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.moodBox = new ComboBox( this );
   this.moodBox.addItem( "Souple" );
   this.moodBox.addItem( "Standard" );
   this.moodBox.addItem( "Strict" );
   this.moodBox.addItem( "Manuel" );
   this.moodBox.currentItem = 1;
   this.moodBox.onItemSelected = function( index ) { this.dialog.moodChanged( index ); };

   this.filterBox = new ComboBox( this );
   this.filterBox.addItem( "Toutes les poses" );
   this.filterBox.addItem( "Gardées" );
   this.filterBox.addItem( "À revoir" );
   this.filterBox.addItem( "Écartées" );
   this.filterBox.addItem( "Suspectes" );
   this.filterBox.onItemSelected = function( index ) { this.dialog.filterChanged( index ); };

   this.playButton = new PushButton( this );
   this.playButton.text = "Lire";
   this.playButton.onClick = function() { this.dialog.togglePlay(); };

   this.fpsControl = new NumericControl( this );
   this.fpsControl.label.text = "Images/s";
   this.fpsControl.setRange( 1, 8 );
   this.fpsControl.setPrecision( 0 );
   this.fpsControl.setValue( 4 );
   this.fpsControl.toolTip = "Cadence de lecture.";

   let dialog = this;
   this.timer = new Timer( 0.25, true, this );
   this.timer.onTimeout = function() { dialog.onBlinkTick(); };

   let top = new HorizontalSizer;
   top.spacing = 6;
   top.add( this.rootEdit, 100 );
   top.add( this.browseButton );
   top.add( this.scanButton );
   top.add( this.measureButton );
   top.addSpacing( 12 );
   top.add( this.moodLabel );
   top.add( this.moodBox );
   top.add( this.filterBox );
   top.add( this.playButton );
   top.add( this.fpsControl );

   this.starFrac = this.makeLimit( "Plancher d'étoiles", 0.15, 0.9, 0.55, 2 );
   this.kSoft = this.makeLimit( "Sévérité du flou", 1, 6, 3, 1 );
   this.eccAbs = this.makeLimit( "Excentricité max", 0.35, 0.9, 0.6, 2 );
   this.skyRatio = this.makeLimit( "Fond max (×)", 1.5, 6, 3, 1 );
   this.limitsSizer = new HorizontalSizer;
   this.limitsSizer.spacing = 8;
   this.limitsSizer.add( this.starFrac );
   this.limitsSizer.add( this.kSoft );
   this.limitsSizer.add( this.eccAbs );
   this.limitsSizer.add( this.skyRatio );
   this.limitsVisible = false;

   this.tree = new TreeBox( this );
   this.tree.numberOfColumns = 8;
   this.tree.headerVisible = true;
   this.tree.multipleSelection = true;
   this.tree.setHeaderText( 0, "Verdict" );
   this.tree.setHeaderText( 1, "Note" );
   this.tree.setHeaderText( 2, "Étoiles" );
   this.tree.setHeaderText( 3, "FWHM" );
   this.tree.setHeaderText( 4, "Exc." );
   this.tree.setHeaderText( 5, "Fond" );
   this.tree.setHeaderText( 6, "Motif" );
   this.tree.setHeaderText( 7, "Fichier" );
   this.tree.setColumnWidth( 0, 90 );
   this.tree.setColumnWidth( 1, 50 );
   this.tree.setColumnWidth( 2, 70 );
   this.tree.setColumnWidth( 3, 60 );
   this.tree.setColumnWidth( 4, 50 );
   this.tree.setColumnWidth( 5, 70 );
   this.tree.setColumnWidth( 6, 180 );
   this.tree.setColumnWidth( 7, 220 );
   this.tree.setScaledMinWidth( 420 );
   this.tree.onNodeSelectionUpdated = function() { this.dialog.onTreeSelection(); };
   this.tree.onKeyPress = function( keyCode ) { return this.dialog.onNavKey( keyCode ); };

   this.preview = new Control( this );
   this.preview.setScaledMinSize( 560, 380 );
   this.preview.onPaint = function()
   {
      let g = new Graphics( this );
      this.dialog.paintPreview( g, this.width, this.height );
      g.end();
   };
   this.preview.onMouseMove = function( x, y )
   {
      this.dialog.onPreviewMove( x, y, this.width, this.height );
   };
   this.preview.onMousePress = function( x, y )
   {
      this.dialog.onPreviewMove( x, y, this.width, this.height );
   };

   this.verdict = new Label( this );
   this.verdict.wordWrapping = true;
   this.verdict.text = "Choisis un dossier, puis Analyse.";
   this.verdict.setScaledMinHeight( 48 );

   this.zoomControl = new NumericControl( this );
   this.zoomControl.label.text = "Loupe";
   this.zoomControl.setRange( 1, 4 );
   this.zoomControl.setPrecision( 0 );
   this.zoomControl.setValue( 1 );
   this.zoomControl.toolTip = "1 montre toute la pose. Au-delà, la loupe suit la souris.";
   this.zoomControl.onValueUpdated = function( value )
   {
      this.dialog.zoom = Math.round( value );
      this.dialog.preview.repaint();
   };

   let right = new VerticalSizer;
   right.spacing = 6;
   right.add( this.preview, 100 );
   right.add( this.verdict );
   right.add( this.zoomControl );

   let middle = new HorizontalSizer;
   middle.spacing = 8;
   middle.add( this.tree, 45 );
   middle.add( right, 55 );

   this.chart = new Control( this );
   this.chart.setScaledMinHeight( 150 );
   this.chart.onPaint = function()
   {
      let g = new Graphics( this );
      this.dialog.paintChart( g, this.width, this.height );
      g.end();
   };
   this.chart.onMousePress = function( x, y )
   {
      this.dialog.onChartPress( x, this.width );
   };

   this.asideButton = new PushButton( this );
   this.asideButton.text = "Écarter";
   this.asideButton.toolTip = "Déplace la sélection vers rejected/. Sans sélection, déplace toutes les poses écartées. Rien n'est supprimé.";
   this.asideButton.onClick = function() { this.dialog.moveAside(); };

   this.restoreButton = new PushButton( this );
   this.restoreButton.text = "Restaurer";
   this.restoreButton.toolTip = "Remet à leur place les fichiers déplacés.";
   this.restoreButton.onClick = function() { this.dialog.restore(); };

   this.deleteButton = new PushButton( this );
   this.deleteButton.text = "Supprimer";
   this.deleteButton.toolTip = "Supprime les fichiers sélectionnés du disque, après confirmation.";
   this.deleteButton.onClick = function() { this.dialog.deleteSelected(); };

   this.csvButton = new PushButton( this );
   this.csvButton.text = "Exporter CSV";
   this.csvButton.onClick = function() { this.dialog.exportCsv(); };

   this.reviewBox = new CheckBox( this );
   this.reviewBox.text = "Inclure les poses à revoir";
   this.reviewBox.checked = true;

   this.wbppButton = new PushButton( this );
   this.wbppButton.text = "Envoyer à WeightedBatchPreprocessing";
   this.wbppButton.toolTip = "Ouvre WBPP dans une nouvelle fenêtre avec les poses gardées et les darks, flats et bias trouvés. La liste enregistrée de WBPP n'est pas remplacée.";
   this.wbppButton.onClick = function() { this.dialog.sendToWBPP(); };

   this.closeButton = new PushButton( this );
   this.closeButton.text = "Fermer";
   this.closeButton.onClick = function()
   {
      this.dialog.timer.stop();
      this.dialog.ok();
   };

   let bottom = new HorizontalSizer;
   bottom.spacing = 6;
   bottom.add( this.asideButton );
   bottom.add( this.restoreButton );
   bottom.add( this.deleteButton );
   bottom.add( this.csvButton );
   bottom.addStretch();
   bottom.add( this.reviewBox );
   bottom.add( this.wbppButton );
   bottom.add( this.closeButton );

   this.status = new Label( this );
   this.status.text = "";

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add( top );
   this.sizer.add( this.limitsSizer );
   this.sizer.add( middle, 100 );
   this.sizer.add( this.chart );
   this.sizer.add( bottom );
   this.sizer.add( this.status );

   this.limitsSizer.enabled = false; // hidden by zero height via enabled; visibility set below
   this.setLimitsVisible( false );
   this.onKeyPress = function( keyCode ) { return this.onNavKey( keyCode ); };
};

BlinkCullDialog.prototype.makeLimit = function( label, low, high, value, precision )
{
   let control = new NumericControl( this );
   control.label.text = label;
   control.setRange( low, high );
   control.setPrecision( precision );
   control.setValue( value );
   control.onValueUpdated = function() { this.dialog.manualLimitsChanged(); };
   return control;
};

BlinkCullDialog.prototype.setLimitsVisible = function( visible )
{
   this.limitsVisible = visible;
   this.starFrac.visible = visible;
   this.kSoft.visible = visible;
   this.eccAbs.visible = visible;
   this.skyRatio.visible = visible;
};

BlinkCullDialog.prototype.currentMood = function()
{
   if ( this.moodBox.currentItem == 3 )
   {
      return {
         id: "manual",
         label: "Manuel",
         starFrac: this.starFrac.value,
         kSoft: this.kSoft.value,
         kTrail: this.kSoft.value,
         eccAbs: this.eccAbs.value,
         skyRatio: this.skyRatio.value
      };
   }
   if ( this.moodBox.currentItem == 0 )
      return BLINK_MOODS.lenient;
   if ( this.moodBox.currentItem == 2 )
      return BLINK_MOODS.strict;
   return BLINK_MOODS.standard;
};

BlinkCullDialog.prototype.moodChanged = function( index )
{
   let hasOverride = false;
   let lights = this.session.lights();
   for ( let i = 0; i < lights.length; ++i )
      if ( lights[ i ].override )
         hasOverride = true;
   if ( hasOverride )
   {
      let box = new MessageBox(
         "Des poses ont été marquées à la main. Garder ces marques ?",
         "Blink des poses",
         StdIcon_Question,
         StdButton_Yes, StdButton_No, StdButton_Cancel );
      let answer = box.execute();
      if ( answer == StdButton_Cancel )
      {
         this.moodBox.currentItem = this.previousMoodIndex == null ? 1 : this.previousMoodIndex;
         return;
      }
      if ( answer == StdButton_No )
         for ( let i = 0; i < lights.length; ++i )
            lights[ i ].override = null;
   }
   this.previousMoodIndex = index;
   this.setLimitsVisible( index == 3 );
   this.regrade();
};

BlinkCullDialog.prototype.manualLimitsChanged = function()
{
   if ( this.moodBox.currentItem == 3 && !this.busy )
      this.regrade();
};

BlinkCullDialog.prototype.filterChanged = function( index )
{
   let modes = [ "all", "keep", "review", "reject", "suspect" ];
   this.filterMode = modes[ index ] || "all";
   this.rebuildTree();
};

BlinkCullDialog.prototype.browse = function()
{
   let dialog = new GetDirectoryDialog;
   dialog.caption = "Dossier des poses";
   if ( this.rootEdit.text )
      dialog.initialPath = this.rootEdit.text;
   if ( dialog.execute() )
      this.rootEdit.text = dialog.directoryPath;
};

BlinkCullDialog.prototype.scan = function()
{
   let root = this.rootEdit.text.trim();
   if ( !root || !File.directoryExists( root ) )
   {
      new MessageBox( "Choisis un dossier qui existe.", "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
      return;
   }
   this.busy = true;
   this.timer.stop();
   this.playing = false;
   this.playButton.text = "Lire";
   Console.abortEnabled = true;
   let dialog = this;
   try
   {
      this.status.text = "Lecture des en-têtes…";
      CoreApplication.processEvents();
      let count = this.session.scan( root, function( seen )
      {
         dialog.status.text = "Lecture des en-têtes… " + seen;
         CoreApplication.processEvents();
      } );
      Settings.write( "BlinkCull/root", DataType_String, root );
      this.cache = [];
      this.previewBitmap = null;
      this.previewPath = "";
      this.regrade();
      let s = this.session.summary();
      this.status.text = count + " fichiers, " + s.lights + " lights, " + s.calibration + " cadres de calibration.";
   }
   catch ( x )
   {
      new MessageBox( x.message, "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
   }
   this.busy = false;
};

BlinkCullDialog.prototype.measure = function()
{
   if ( this.session.lights().length == 0 )
   {
      new MessageBox( "Aucune pose light à mesurer. Lance d'abord l'analyse.", "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
      return;
   }
   this.busy = true;
   this.timer.stop();
   this.playing = false;
   this.playButton.text = "Lire";
   try
   {
      this.status.text = "Mesure en cours…";
      CoreApplication.processEvents();
      let n = this.session.measure( function( done, total )
      {
         // SubframeSelector bloque jusqu'à la fin ; ce rappel sert après coup.
      } );
      this.regrade();
      this.status.text = n + " poses mesurées.";
   }
   catch ( x )
   {
      new MessageBox( x.message, "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
   }
   this.busy = false;
};

BlinkCullDialog.prototype.regrade = function()
{
   if ( this.session.lights().length == 0 )
   {
      this.rebuildTree();
      this.updateStatus();
      return;
   }
   this.session.grade( this.currentMood() );
   this.rebuildTree();
   this.updateStatus();
   this.chart.repaint();
};

BlinkCullDialog.prototype.visibleLights = function()
{
   let lights = this.session.lights();
   let out = [];
   for ( let i = 0; i < lights.length; ++i )
   {
      let v = effectiveVerdict( lights[ i ] );
      if ( this.filterMode == "all"
         || this.filterMode == v
         || ( this.filterMode == "suspect" && ( v == "review" || v == "reject" || v == "unread" ) ) )
         out.push( lights[ i ] );
   }
   return out;
};

BlinkCullDialog.prototype.rebuildTree = function()
{
   this.tree.clear();
   let lights = this.visibleLights();
   for ( let i = 0; i < lights.length; ++i )
   {
      let frame = lights[ i ];
      let node = new TreeBoxNode( this.tree );
      frame.node = node;
      node.__frame__ = frame;
      this.fillNode( node, frame );
   }
   if ( lights.length > 0 )
   {
      this.playIndex = Math.min( this.playIndex, lights.length - 1 );
      this.showFrame( lights[ this.playIndex ], false );
   }
   else
   {
      this.verdict.text = "Aucune pose dans ce filtre.";
      this.previewBitmap = null;
      this.preview.repaint();
   }
   this.chart.repaint();
};

BlinkCullDialog.prototype.fillNode = function( node, frame )
{
   let verdict = effectiveVerdict( frame );
   let mark = frame.override ? " ·" : "";
   node.setText( 0, verdictLabel( verdict ) + mark );
   node.setTextColor( 0, blinkVerdictColor( verdict ) );
   node.setText( 1, frame.score == null ? "" : String( frame.score ) );
   let m = frame.measure || {};
   node.setText( 2, m.stars > 0 ? String( Math.round( m.stars ) ) : "" );
   node.setText( 3, blinkFormat( m.fwhm, 2 ) );
   node.setText( 4, blinkFormat( m.eccentricity, 2 ) );
   node.setText( 5, blinkFormat( m.median, 4 ) );
   node.setText( 6, frame.autoReason || "" );
   node.setText( 7, File.extractName( frame.path ) );
   node.setToolTip( 7, frame.path );
};

BlinkCullDialog.prototype.refreshNodes = function()
{
   let lights = this.visibleLights();
   for ( let i = 0; i < lights.length; ++i )
      if ( lights[ i ].node )
         this.fillNode( lights[ i ].node, lights[ i ] );
   this.updateStatus();
   this.chart.repaint();
};

BlinkCullDialog.prototype.updateStatus = function()
{
   let s = this.session.summary();
   if ( s.lights == 0 && this.session.frames.length == 0 )
   {
      this.status.text = "";
      return;
   }
   this.status.text = s.lights + " lights · " + s.keep + " gardées · " + s.review + " à revoir · "
      + s.reject + " écartées · " + s.unread + " illisibles · "
      + format( "%.2f h gardées", s.hours ) + " · " + s.calibration + " calibration";
};

BlinkCullDialog.prototype.onTreeSelection = function()
{
   if ( this.playing )
      return;
   let node = this.tree.currentNode;
   if ( !node || !node.__frame__ )
      return;
   let lights = this.visibleLights();
   for ( let i = 0; i < lights.length; ++i )
      if ( lights[ i ] === node.__frame__ )
         this.playIndex = i;
   this.showFrame( node.__frame__, false );
};

BlinkCullDialog.prototype.showFrame = function( frame, selectNode )
{
   if ( !frame )
      return;
   if ( selectNode && frame.node )
   {
      this.tree.currentNode = frame.node;
      frame.node.selected = true;
   }
   let verdict = effectiveVerdict( frame );
   let reason = frame.autoReason ? ( " — " + frame.autoReason ) : "";
   let hand = frame.override ? " (marque manuelle)" : "";
   this.verdict.text = verdictLabel( verdict ) + hand + reason + "\n" + frame.path;
   if ( this.previewPath == frame.path && this.previewBitmap )
   {
      this.preview.repaint();
      return;
   }
   let cached = null;
   for ( let i = 0; i < this.cache.length; ++i )
      if ( this.cache[ i ].path == frame.path )
         cached = this.cache[ i ].bitmap;
   try
   {
      if ( !cached )
      {
         this.status.text = "Aperçu : " + File.extractName( frame.path );
         CoreApplication.processEvents();
         cached = blinkReadPreview( frame.path );
         this.cache.push( { path: frame.path, bitmap: cached } );
         if ( this.cache.length > 24 )
            this.cache.shift();
      }
      this.previewBitmap = cached;
      this.previewPath = frame.path;
   }
   catch ( x )
   {
      this.previewBitmap = null;
      this.previewPath = "";
      this.verdict.text = x.message;
   }
   this.preview.repaint();
};

BlinkCullDialog.prototype.paintPreview = function( g, width, height )
{
   g.fillRect( 0, 0, width, height, new Brush( 0xFF1A1A1A ) );
   let bmp = this.previewBitmap;
   if ( !bmp || bmp.isEmpty )
      return;
   if ( this.zoom <= 1 )
   {
      let scale = Math.min( width / bmp.width, height / bmp.height );
      let dw = Math.max( 1, Math.round( bmp.width * scale ) );
      let dh = Math.max( 1, Math.round( bmp.height * scale ) );
      let view = bmp.scaledTo( dw, dh );
      g.drawBitmap( Math.round( ( width - dw ) / 2 ), Math.round( ( height - dh ) / 2 ), view );
      return;
   }
   let srcW = Math.max( 8, Math.round( bmp.width / this.zoom ) );
   let srcH = Math.max( 8, Math.round( bmp.height / this.zoom ) );
   let cx = this.focusX * bmp.width;
   let cy = this.focusY * bmp.height;
   let x0 = Math.round( Math.range( cx - srcW / 2, 0, bmp.width - srcW ) );
   let y0 = Math.round( Math.range( cy - srcH / 2, 0, bmp.height - srcH ) );
   let crop = bmp.subimage( x0, y0, x0 + srcW, y0 + srcH );
   g.drawBitmap( 0, 0, crop.scaledTo( width, height ) );
};

BlinkCullDialog.prototype.onPreviewMove = function( x, y, width, height )
{
   if ( this.zoom <= 1 || !this.previewBitmap || width <= 0 || height <= 0 )
      return;
   this.focusX = Math.range( x / width, 0, 1 );
   this.focusY = Math.range( y / height, 0, 1 );
   this.preview.repaint();
};

BlinkCullDialog.prototype.visibleIndex = function( frame )
{
   let lights = this.visibleLights();
   for ( let i = 0; i < lights.length; ++i )
      if ( lights[ i ] === frame )
         return i;
   return -1;
};

BlinkCullDialog.prototype.step = function( delta )
{
   let lights = this.visibleLights();
   if ( lights.length == 0 )
      return;
   this.playIndex = ( this.playIndex + delta + lights.length ) % lights.length;
   this.showFrame( lights[ this.playIndex ], true );
};

BlinkCullDialog.prototype.cycleOverride = function( frame )
{
   if ( !frame )
      return;
   if ( frame.override == null )
      frame.override = ( frame.autoVerdict == "reject" ) ? "keep" : "reject";
   else if ( frame.override == "reject" )
      frame.override = "keep";
   else
      frame.override = null;
   if ( frame.node )
      this.fillNode( frame.node, frame );
   this.showFrame( frame, false );
   this.updateStatus();
   this.chart.repaint();
};

BlinkCullDialog.prototype.onNavKey = function( keyCode )
{
   if ( keyCode == Key_Left )
   {
      this.timer.stop();
      this.playing = false;
      this.playButton.text = "Lire";
      this.step( -1 );
      return true;
   }
   if ( keyCode == Key_Right )
   {
      this.timer.stop();
      this.playing = false;
      this.playButton.text = "Lire";
      this.step( 1 );
      return true;
   }
   if ( keyCode == Key_Space )
   {
      let lights = this.visibleLights();
      if ( lights[ this.playIndex ] )
         this.cycleOverride( lights[ this.playIndex ] );
      return true;
   }
   return false;
};

BlinkCullDialog.prototype.togglePlay = function()
{
   let lights = this.visibleLights();
   if ( lights.length == 0 )
      return;
   this.playing = !this.playing;
   if ( this.playing )
   {
      this.playButton.text = "Pause";
      let fps = Math.max( 1, this.fpsControl.value );
      this.timer.interval = 1 / fps;
      this.timer.start();
   }
   else
   {
      this.playButton.text = "Lire";
      this.timer.stop();
   }
};

BlinkCullDialog.prototype.onBlinkTick = function()
{
   if ( !this.playing )
      return;
   let fps = Math.max( 1, this.fpsControl.value );
   this.timer.interval = 1 / fps;
   this.step( 1 );
};

BlinkCullDialog.prototype.paintChart = function( g, width, height )
{
   g.fillRect( 0, 0, width, height, new Brush( 0xFF111111 ) );
   let lights = this.visibleLights();
   if ( lights.length == 0 )
      return;
   let stars = [], fwhm = [], sky = [];
   for ( let i = 0; i < lights.length; ++i )
   {
      let m = lights[ i ].measure || {};
      stars.push( m.stars );
      fwhm.push( m.fwhm );
      sky.push( m.median );
   }
   let pad = 8;
   let plotH = height - 22;
   this.drawSeries( g, stars, 0xFF7EB6FF, pad, 4, width - pad, plotH * 0.72 );
   this.drawSeries( g, fwhm, 0xFFFFB020, pad, 4, width - pad, plotH * 0.72 );
   this.drawSeries( g, sky, 0xFFB0B0B0, pad, 4, width - pad, plotH * 0.72 );
   let bandY = plotH;
   for ( let i = 0; i < lights.length; ++i )
   {
      let x0 = pad + ( width - 2 * pad ) * i / lights.length;
      let x1 = pad + ( width - 2 * pad ) * ( i + 1 ) / lights.length;
      g.fillRect( x0, bandY, Math.max( x0 + 1, x1 ), height - 4, new Brush( blinkVerdictColor( effectiveVerdict( lights[ i ] ) ) ) );
   }
   if ( this.playIndex >= 0 && this.playIndex < lights.length )
   {
      let x = pad + ( width - 2 * pad ) * ( this.playIndex + 0.5 ) / lights.length;
      g.pen = new Pen( 0xFFFFFFFF );
      g.drawLine( x, 2, x, height - 2 );
   }
};

BlinkCullDialog.prototype.drawSeries = function( g, values, color, x0, y0, x1, y1 )
{
   let finite = [];
   for ( let i = 0; i < values.length; ++i )
      if ( isFinite( values[ i ] ) )
         finite.push( values[ i ] );
   if ( finite.length < 2 )
      return;
   let lo = Math.min.apply( null, finite );
   let hi = Math.max.apply( null, finite );
   if ( hi <= lo )
      hi = lo + 1;
   g.pen = new Pen( color );
   let prev = null;
   for ( let i = 0; i < values.length; ++i )
   {
      if ( !isFinite( values[ i ] ) )
      {
         prev = null;
         continue;
      }
      let x = x0 + ( x1 - x0 ) * ( values.length == 1 ? 0.5 : i / ( values.length - 1 ) );
      let y = y1 - ( y1 - y0 ) * ( values[ i ] - lo ) / ( hi - lo );
      if ( prev )
         g.drawLine( prev.x, prev.y, x, y );
      prev = { x: x, y: y };
   }
};

BlinkCullDialog.prototype.onChartPress = function( x, width )
{
   let lights = this.visibleLights();
   if ( lights.length == 0 )
      return;
   let pad = 8;
   let t = ( x - pad ) / Math.max( 1, width - 2 * pad );
   let index = Math.round( Math.range( t, 0, 1 ) * ( lights.length - 1 ) );
   this.timer.stop();
   this.playing = false;
   this.playButton.text = "Lire";
   this.playIndex = index;
   this.showFrame( lights[ index ], true );
};

BlinkCullDialog.prototype.selectedFrames = function()
{
   let nodes = this.tree.selectedNodes;
   let frames = [];
   for ( let i = 0; i < nodes.length; ++i )
      if ( nodes[ i ].__frame__ )
         frames.push( nodes[ i ].__frame__ );
   return frames;
};

BlinkCullDialog.prototype.moveAside = function()
{
   let frames = this.selectedFrames();
   if ( frames.length == 0 )
   {
      frames = [];
      let lights = this.session.lights();
      for ( let i = 0; i < lights.length; ++i )
         if ( effectiveVerdict( lights[ i ] ) == "reject" )
            frames.push( lights[ i ] );
   }
   if ( frames.length == 0 )
   {
      new MessageBox( "Rien à écarter.", "Blink des poses", StdIcon_Information, StdButton_Ok ).execute();
      return;
   }
   try
   {
      let n = this.session.moveAside( frames );
      this.cache = [];
      this.previewBitmap = null;
      this.previewPath = "";
      this.rebuildTree();
      this.status.text = n + " fichier(s) déplacé(s) vers rejected/.";
   }
   catch ( x )
   {
      new MessageBox( x.message, "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
   }
};

BlinkCullDialog.prototype.restore = function()
{
   try
   {
      let n = this.session.restoreAll();
      this.cache = [];
      this.previewBitmap = null;
      this.previewPath = "";
      this.rebuildTree();
      this.status.text = n + " fichier(s) restauré(s).";
   }
   catch ( x )
   {
      new MessageBox( x.message, "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
   }
};

BlinkCullDialog.prototype.deleteSelected = function()
{
   let frames = this.selectedFrames();
   if ( frames.length == 0 )
   {
      new MessageBox( "Sélectionne les fichiers à supprimer.", "Blink des poses", StdIcon_Warning, StdButton_Ok ).execute();
      return;
   }
   let box = new MessageBox(
      "Supprimer définitivement " + frames.length + " fichier(s) du disque ?",
      "Blink des poses",
      StdIcon_Warning,
      StdButton_Yes, StdButton_No );
   if ( box.execute() != StdButton_Yes )
      return;
   try
   {
      let n = this.session.deleteFiles( frames );
      this.cache = [];
      this.previewBitmap = null;
      this.previewPath = "";
      this.rebuildTree();
      this.status.text = n + " fichier(s) supprimé(s).";
   }
   catch ( x )
   {
      new MessageBox( x.message, "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
   }
};

BlinkCullDialog.prototype.exportCsv = function()
{
   if ( this.session.frames.length == 0 )
      return;
   let dialog = new SaveFileDialog;
   dialog.caption = "Exporter les notes";
   dialog.filters = [ [ "CSV", "*.csv" ] ];
   if ( this.session.root )
      dialog.initialPath = this.session.root + "/blink-cull.csv";
   if ( !dialog.execute() )
      return;
   try
   {
      File.writeTextFile( dialog.filePath, this.session.csvText() );
      this.status.text = "Notes écrites : " + dialog.filePath;
   }
   catch ( x )
   {
      new MessageBox( x.message, "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
   }
};

BlinkCullDialog.prototype.sendToWBPP = function()
{
   if ( !this.session.root )
   {
      new MessageBox( "Analyse d'abord un dossier.", "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
      return;
   }
   let files = this.session.filesForWBPP( this.reviewBox.checked );
   if ( files.length == 0 )
   {
      new MessageBox( "Aucune pose à envoyer.", "Blink des poses", StdIcon_Warning, StdButton_Ok ).execute();
      return;
   }
   let out = new GetDirectoryDialog;
   out.caption = "Dossier de sortie de WeightedBatchPreprocessing";
   out.initialPath = this.session.root + "/wbpp";
   if ( !out.execute() )
      return;
   try
   {
      File.createDirectory( out.directoryPath, true );
      let script = blinkLaunchWBPP( files, out.directoryPath );
      this.status.text = files.length + " fichiers envoyés. WBPP s'ouvre dans une nouvelle fenêtre. Script : " + script;
   }
   catch ( x )
   {
      new MessageBox( x.message, "Blink des poses", StdIcon_Error, StdButton_Ok ).execute();
   }
};

function blinkCullSelfCheck()
{
   let image = new Image( 48, 48, 1, ColorSpace.Gray, 32, PixelSampleType.Float );
   image.fill( 0.01 );
   image.setSample( 0.8, 20, 20, 0 );
   blinkDisplayStretch( image );
   let bmp = image.render();
   if ( !bmp || bmp.width != 48 )
      throw new Error( "Aperçu : rendu inattendu." );
   if ( typeof SubframeSelector == "undefined" || SubframeSelector.MeasureSubframes == undefined )
      throw new Error( "SubframeSelector est introuvable." );
   console.noteln( "BlinkCull : contrôles internes ok." );
}
