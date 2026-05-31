import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0120_backuprestoreaudit_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='InventoryAdjustment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('adjustment_number', models.CharField(blank=True, max_length=64)),
                ('adjustment_date', models.DateField()),
                ('reason', models.CharField(default='count', max_length=16)),
                ('status', models.CharField(default='draft', max_length=16)),
                ('memo', models.CharField(blank=True, max_length=500)),
                ('posted_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('company', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='inventory_adjustments', to='api.company')),
                ('station', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='inventory_adjustments', to='api.station')),
            ],
            options={
                'db_table': 'inventory_adjustment',
                'ordering': ['-adjustment_date', '-id'],
            },
        ),
        migrations.CreateModel(
            name='InventoryAdjustmentLine',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('counted_quantity', models.DecimalField(decimal_places=4, max_digits=14)),
                ('book_quantity', models.DecimalField(blank=True, decimal_places=4, max_digits=14, null=True)),
                ('unit_cost', models.DecimalField(blank=True, decimal_places=4, max_digits=14, null=True)),
                ('adjustment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lines', to='api.inventoryadjustment')),
                ('item', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='inventory_adjustment_lines', to='api.item')),
            ],
            options={
                'db_table': 'inventory_adjustment_line',
            },
        ),
    ]
